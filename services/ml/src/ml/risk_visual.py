"""Moduł 2, reguły wizualne z klatek filmu (4, 5, 6, 8, 13). OCR + pomiary pikseli, bez LLM.

Jedno przejście OCR po klatkach materiału daje linie tekstu z pomiarami, a z nich reguły:
- 4  rozmiar czcionki ryzyka: wysokość linii ostrzeżenia / mediana wysokości pozostałych linii
     w klatce, w której ostrzeżenie jest pokazane najlepiej; naruszenie poniżej 0,6,
- 5  kontrast ostrzeżenia (WCAG, tekst-tło w ramce) w najlepszej klatce; naruszenie poniżej 4,5:1
     (3:1 dla dużego tekstu),
- 6  ukrywanie ostrzeżenia: tylko w pasku przy górnej/dolnej krawędzi kadru albo na ekranie
     krócej, niż trwa jego przeczytanie (3 słowa na sekundę),
- 8  responsywność: wysokość linii ostrzeżenia w pikselach CSS po przeskalowaniu filmu do
     odtwarzacza na telefonie, tablecie i komputerze; naruszenie, gdy na którymś ekranie
     najczytelniejsza linia ostrzeżenia ma mniej niż 9 px,
- 13 dominacja wyników historycznych: linia z wynikiem historycznym ma najwyższą ekspozycję
     w klatce. Ekspozycja = wysokość x kontrast x położenie x (1 + 3 * udział w mapie uwagi).

OCR: RapidOCR (PP-OCRv6, modele w paczce, bez internetu) na kopii roboczej klatki (szarość,
CLAHE, powiększenie x2). Pomiary na ORYGINALE: poprawianie kontrastu ukryłoby naruszenie z reguły 5.
Ostrzeżenia i wyniki historyczne rozpoznajemy tymi samymi frazami co w tekście (`risk._FEATURES`).

Klatki: `${MEDIA_DIR}/<material_id>/manifest.json` + pliki PNG (docs/KLATKI.md).
"""

import json
import math
import os
import re
import statistics
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np

from ml.risk import _FEATURES, Finding

if TYPE_CHECKING:
    from rapidocr import RapidOCR

VISUAL_RULES: tuple[str, ...] = ("4", "5", "6", "8", "13")

FONT_RATIO_MIN = 0.6  # reguła 4
CONTRAST_MIN = 4.5  # reguła 5, tekst zwykły
CONTRAST_MIN_LARGE = 3.0  # reguła 5, duży tekst
LARGE_TEXT_HEIGHT = 0.05  # ułamek wysokości kadru, od którego tekst uznajemy za duży
EDGE_BAND = 0.1  # reguła 6 i 13: górne i dolne 10% kadru
WORDS_PER_SECOND = 3.0  # reguła 6: tempo czytania
DOMINANCE_MIN = 1.0  # reguła 13
EDGE_WEIGHT = 0.6
CONTRAST_CAP = 7.0
SALIENCY_GAIN = 3.0
OCR_MIN_SCORE = 0.5
QUOTE_MAX = 300
DEFAULT_FRAME_SECONDS = 1.0  # gdy manifest nie podaje `until`
DEFAULT_ASPECT = 16 / 9  # szerokość / wysokość klatki, gdy jej nie znamy
# Reguła 8: odtwarzacz YouTube w widoku domyślnym (bez pełnego ekranu) — szerokość i maksymalna
# wysokość obszaru filmu w pikselach CSS. Film skaluje się proporcjonalnie, aż trafi na któryś bok.
DEVICES: tuple[tuple[str, float, float], ...] = (
    ("telefon", 375, 812),
    ("tablet", 768, 1024),
    ("komputer", 854, 480),
)
# Wysokość ramki OCR linii (≈ rozmiar czcionki) w px CSS, poniżej której tekst jest nieczytelny.
READABLE_MIN_PX = 9.0

# OCR potrafi zamienić polskie litery na podobne z innych alfabetów łacińskich.
_PL_FIX = str.maketrans({"ž": "ż", "Ž": "Ż", "š": "ś", "Š": "Ś", "č": "ć", "Č": "Ć"})
# Procent przy roku: „+142% w 2023!”, „2019-2024: 87%”.
_PERCENT_WITH_YEAR = re.compile(
    r"[+-]?\d+(?:[.,]\d+)?\s?%.{0,30}\b(?:19|20)\d{2}\b"
    r"|\b(?:19|20)\d{2}\b.{0,30}[+-]?\d+(?:[.,]\d+)?\s?%",
    re.IGNORECASE,
)
# Tylko wyraźne ostrzeżenia (wagi >= 0,9), nie samo słowo „ryzyko”.
_WARNING_MIN_WEIGHT = 0.9
_HISTORICAL_MIN_WEIGHT = 0.7


@dataclass(frozen=True)
class FrameRef:
    ts: float
    file: str
    seconds: float  # jak długo klatka jest na ekranie (until - ts)


@dataclass(frozen=True)
class TextLine:
    text: str
    box: tuple[float, float, float, float]  # x0, y0, x1, y1 jako ułamki kadru
    height: float
    contrast: float
    saliency: float

    @property
    def at_edge(self) -> bool:
        center = (self.box[1] + self.box[3]) / 2
        return center < EDGE_BAND or center > 1 - EDGE_BAND

    @property
    def exposure(self) -> float:
        contrast = min(self.contrast, CONTRAST_CAP) / CONTRAST_CAP
        position = EDGE_WEIGHT if self.at_edge else 1.0
        return self.height * contrast * position * (1 + SALIENCY_GAIN * self.saliency)


@dataclass(frozen=True)
class FrameText:
    ref: FrameRef
    lines: list[TextLine]
    aspect: float = DEFAULT_ASPECT  # szerokość / wysokość klatki

    def displayed_height(self, width: float, max_height: float) -> float:
        """Wysokość filmu w px CSS w odtwarzaczu o szerokości `width` i wysokości `max_height`."""
        return min(width / self.aspect, max_height)


# ─── OCR i pomiary ──────────────────────────────────────────────────────────────────────────


@cache
def _ocr_engine() -> "RapidOCR":
    from rapidocr import RapidOCR

    return RapidOCR(params={"Global.log_level": "warning"})


def _working_copy(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    big = cv2.resize(clahe, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    return cv2.cvtColor(big, cv2.COLOR_GRAY2BGR)


def _relative_luminance(bgr: np.ndarray) -> float:
    channels = []
    for value in bgr[::-1] / 255.0:  # BGR -> RGB
        channels.append(value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4)
    r, g, b = channels
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(image: np.ndarray, box_px: tuple[int, int, int, int]) -> float:
    """Kontrast WCAG między dwoma dominującymi kolorami w ramce (tekst i tło)."""
    x0, y0, x1, y1 = box_px
    crop = image[max(0, y0) : max(y0 + 1, y1), max(0, x0) : max(x0 + 1, x1)]
    pixels = crop.reshape(-1, 3).astype(np.float32)
    if len(pixels) < 2:
        return 1.0
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, _, centers = cv2.kmeans(pixels, 2, None, criteria, 3, cv2.KMEANS_PP_CENTERS)  # type: ignore[call-overload]
    lighter, darker = sorted((_relative_luminance(c) for c in centers), reverse=True)
    return float((lighter + 0.05) / (darker + 0.05))


def saliency_map(image: np.ndarray) -> np.ndarray:
    """Mapa uwagi metodą spectral residual (Hou, Zhang 2007), znormalizowana do sumy 1."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
    small = cv2.resize(gray, (64, max(1, round(64 * gray.shape[0] / gray.shape[1]))))
    spectrum = np.fft.fft2(small)
    log_amplitude = np.log(np.abs(spectrum) + 1e-9).astype(np.float32)
    residual = log_amplitude - cv2.blur(log_amplitude, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(spectrum)))) ** 2
    sal = cv2.GaussianBlur(sal.astype(np.float32), (5, 5), 2.5)
    sal = cv2.resize(sal, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_LINEAR)
    total = float(sal.sum())
    return sal / total if total > 0 else sal


def read_lines(image: np.ndarray) -> list[TextLine]:
    """Linie tekstu z klatki z pomiarami na oryginale."""
    from rapidocr.utils.output import RapidOCROutput

    h, w = image.shape[:2]
    result = _ocr_engine()(_working_copy(image))
    if not isinstance(result, RapidOCROutput) or result.boxes is None or not result.txts:
        return []
    sal = saliency_map(image)
    lines: list[TextLine] = []
    for box, text, score in zip(result.boxes, result.txts, result.scores or (), strict=False):
        if float(score) < OCR_MIN_SCORE or not str(text).strip():
            continue
        pts = np.asarray(box, dtype=np.float32) / 2  # współrzędne z kopii roboczej x2
        x0, y0 = (max(0, int(v)) for v in pts.min(axis=0))
        x1 = min(w, math.ceil(float(pts[:, 0].max())))
        y1 = min(h, math.ceil(float(pts[:, 1].max())))
        if x1 <= x0 or y1 <= y0:
            continue
        lines.append(
            TextLine(
                text=str(text).translate(_PL_FIX).strip(),
                box=(x0 / w, y0 / h, x1 / w, y1 / h),
                height=(y1 - y0) / h,
                contrast=contrast_ratio(image, (x0, y0, x1, y1)),
                saliency=float(sal[y0:y1, x0:x1].sum()),
            )
        )
    return lines


# ─── Klasyfikacja linii ─────────────────────────────────────────────────────────────────────


def _matches(feature: str, text: str, min_weight: float) -> bool:
    return any(w >= min_weight and p.search(text) for p, w in _FEATURES[feature])


def is_warning(text: str) -> bool:
    return _matches("risk_warning", text, _WARNING_MIN_WEIGHT)


def is_historical(text: str) -> bool:
    return bool(_PERCENT_WITH_YEAR.search(text)) or _matches(
        "historical_results", text, _HISTORICAL_MIN_WEIGHT
    )


# ─── Reguły ─────────────────────────────────────────────────────────────────────────────────


def _ts(seconds: float) -> str:
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def _frame(ref: FrameRef, line: TextLine) -> dict[str, Any]:
    return {"ts": ref.ts, "file": ref.file, "box": [round(v, 4) for v in line.box]}


def _confidence(distance: float, scale: float) -> float:
    """0,5 tuż przy progu, rośnie z odległością od progu do 0,95."""
    return round(float(min(0.95, 0.5 + 0.45 * min(1.0, abs(distance) / scale))), 3)


def _finding(
    rule_id: str, violated: bool, confidence: float, ref: FrameRef, line: TextLine, reason: str
) -> Finding:
    result = "violation" if violated else "ok"
    quote = line.text[:QUOTE_MAX]
    return Finding(rule_id, result, confidence, quote, reason, None, _frame(ref, line))


Warnings = list[tuple[FrameText, TextLine]]


def _rule_4(warnings: Warnings) -> Finding:
    frame, warning = max(warnings, key=lambda item: item[1].height)
    others = [line.height for line in frame.lines if line is not warning]
    if not others:
        reason = "Ostrzeżenie jest jedynym tekstem klatki: brak odniesienia dla rozmiaru."
        return _finding("4", False, 0.6, frame.ref, warning, reason)
    ratio = warning.height / statistics.median(others)
    reason = (
        f"Ostrzeżenie ma {ratio:.0%} wysokości typowego tekstu klatki {_ts(frame.ref.ts)} "
        f"(próg {FONT_RATIO_MIN:.0%})."
    )
    confidence = _confidence(ratio - FONT_RATIO_MIN, 0.4)
    return _finding("4", ratio < FONT_RATIO_MIN, confidence, frame.ref, warning, reason)


def _rule_5(warnings: Warnings) -> Finding:
    frame, warning = max(warnings, key=lambda item: item[1].contrast)
    minimum = CONTRAST_MIN_LARGE if warning.height >= LARGE_TEXT_HEIGHT else CONTRAST_MIN
    reason = (
        f"Kontrast ostrzeżenia z tłem {warning.contrast:.1f}:1 w najlepszej klatce "
        f"{_ts(frame.ref.ts)} (minimum {minimum:g}:1)."
    )
    confidence = _confidence(warning.contrast - minimum, minimum)
    return _finding("5", warning.contrast < minimum, confidence, frame.ref, warning, reason)


def _rule_6(warnings: Warnings) -> Finding:
    seconds_by_frame = {f.ref.file: f.ref.seconds for f, _ in warnings}
    on_screen = sum(seconds_by_frame.values())
    frame, line = max(warnings, key=lambda item: len(item[1].text.split()))
    needed = len(line.text.split()) / WORDS_PER_SECOND
    only_edge = all(ln.at_edge for _, ln in warnings)
    too_short = on_screen < needed
    problems = []
    if only_edge:
        problems.append("tylko w pasku przy krawędzi kadru")
    if too_short:
        problems.append(f"na ekranie {on_screen:.0f} s, a przeczytanie wymaga ok. {needed:.0f} s")
    if problems:
        reason = "Ostrzeżenie ukryte: " + "; ".join(problems) + "."
        distance = max(needed - on_screen, 0.0) + (needed if only_edge else 0.0)
    else:
        reason = f"Ostrzeżenie w kadrze, na ekranie {on_screen:.0f} s (potrzeba {needed:.0f} s)."
        distance = on_screen - needed
    confidence = _confidence(distance, max(needed, 1.0))
    return _finding("6", bool(problems), confidence, frame.ref, line, reason)


def _rule_8(warnings: Warnings) -> Finding:
    def smallest_px(item: tuple[FrameText, TextLine]) -> float:
        frame, line = item
        return min(line.height * frame.displayed_height(w, h) for _, w, h in DEVICES)

    # Najczytelniejsza linia ostrzeżenia: jeśli ona jest za mała, każda inna też.
    frame, warning = max(warnings, key=smallest_px)
    sizes = [(name, warning.height * frame.displayed_height(w, h)) for name, w, h in DEVICES]
    too_small = [name for name, px in sizes if px < READABLE_MIN_PX]
    listed = ", ".join(f"{name} {px:.0f} px" for name, px in sizes)
    if too_small:
        reason = (
            f"Ostrzeżenie (klatka {_ts(frame.ref.ts)}) po przeskalowaniu filmu jest nieczytelne "
            f"na ekranie: {', '.join(too_small)}. Wysokość tekstu: {listed} "
            f"(minimum {READABLE_MIN_PX:g} px)."
        )
    else:
        reason = (
            f"Ostrzeżenie (klatka {_ts(frame.ref.ts)}) czytelne na wszystkich ekranach. "
            f"Wysokość tekstu: {listed} (minimum {READABLE_MIN_PX:g} px)."
        )
    smallest = min(px for _, px in sizes)
    confidence = _confidence(smallest - READABLE_MIN_PX, READABLE_MIN_PX / 2)
    return _finding("8", bool(too_small), confidence, frame.ref, warning, reason)


def _rule_13(frames: list[FrameText]) -> Finding:
    best: tuple[float, FrameRef, TextLine, TextLine | None] | None = None
    for frame in frames:
        historical = [line for line in frame.lines if is_historical(line.text)]
        if not historical:
            continue
        top = max(historical, key=lambda line: line.exposure)
        rival = max(
            (line for line in frame.lines if not is_historical(line.text)),
            key=lambda line: line.exposure,
            default=None,
        )
        ratio = top.exposure / rival.exposure if rival and rival.exposure > 0 else math.inf
        if best is None or ratio > best[0]:
            best = (ratio, frame.ref, top, rival)
    if best is None:
        return Finding("13", "n/a", 0.9, None, "Na klatkach filmu nie ma wyników historycznych.")
    ratio, ref, top, rival = best
    if math.isinf(ratio):
        reason = f"Wynik historyczny „{top.text[:60]}” to jedyny tekst klatki {_ts(ref.ts)}."
        return _finding("13", True, 0.95, ref, top, reason)
    rival_text = f"„{rival.text[:60]}”" if rival else "brak innego tekstu"
    if ratio >= DOMINANCE_MIN:
        reason = (
            f"Wynik historyczny „{top.text[:60]}” jest najbardziej wyeksponowanym elementem klatki "
            f"{_ts(ref.ts)}: {top.height:.0%} wysokości kadru, ekspozycja {ratio:.1f} razy większa "
            f"niż {rival_text}."
        )
    else:
        reason = (
            f"Wynik historyczny „{top.text[:60]}” nie dominuje: najbardziej wyeksponowany jest "
            f"{rival_text} (wynik ma {ratio:.0%} jego ekspozycji), klatka {_ts(ref.ts)}."
        )
    confidence = _confidence(ratio - DOMINANCE_MIN, 1.0)
    return _finding("13", ratio >= DOMINANCE_MIN, confidence, ref, top, reason)


_WARNING_RULES: dict[str, Callable[[Warnings], Finding]] = {
    "4": _rule_4,
    "5": _rule_5,
    "6": _rule_6,
    "8": _rule_8,
}


def read_frames(frames: list[tuple[FrameRef, np.ndarray]]) -> list[FrameText]:
    """Jedno przejście OCR po klatkach materiału (dla reguł wizualnych i reguły 7)."""
    texts: list[FrameText] = []
    for ref, image in frames:
        h, w = image.shape[:2]
        texts.append(FrameText(ref, read_lines(image), w / h if h else DEFAULT_ASPECT))
    return texts


def warning_lines(texts: list[FrameText]) -> Warnings:
    """Linie z wyraźnym ostrzeżeniem o ryzyku ze wszystkich klatek."""
    return [(frame, line) for frame in texts for line in frame.lines if is_warning(line.text)]


def frame_of(frame: FrameText, line: TextLine) -> dict[str, Any]:
    """Klatka i ramka linii jako `Finding.frame` (dowód z klatki, KONTRAKT.md §2)."""
    return _frame(frame.ref, line)


def evaluate_frames(frames: list[tuple[FrameRef, np.ndarray]]) -> list[Finding]:
    """Reguły 4, 5, 6, 8, 13 dla klatek jednego materiału (jedno przejście OCR)."""
    return evaluate_texts(read_frames(frames))


def evaluate_texts(texts: list[FrameText]) -> list[Finding]:
    """Reguły 4, 5, 6, 8, 13 z tekstu klatek odczytanego przez `read_frames`."""
    if not texts:
        reason = "Brak klatek filmu: reguła wymaga obrazu."
        return [Finding(rule, "n/a", 0.0, None, reason) for rule in VISUAL_RULES]
    warnings = warning_lines(texts)
    findings: list[Finding] = []
    for rule, evaluate in _WARNING_RULES.items():
        if warnings:
            findings.append(evaluate(warnings))
        else:
            reason = "Na klatkach nie ma ostrzeżenia o ryzyku (jego brak ocenia reguła 3)."
            findings.append(Finding(rule, "n/a", 0.9, None, reason))
    findings.append(_rule_13(texts))
    return findings


# ─── Klatki z dysku ─────────────────────────────────────────────────────────────────────────


def media_dir() -> Path | None:
    value = os.environ.get("MEDIA_DIR")
    return Path(value) if value else None


def load_frames(material_id: str) -> list[tuple[FrameRef, np.ndarray]] | None:
    """Klatki z `${MEDIA_DIR}/<material_id>/manifest.json`; None = brak klatek dla materiału."""
    root = media_dir()
    if root is None or not re.fullmatch(r"[\w-]{1,100}", material_id):
        return None
    folder = root / material_id
    manifest_path = folder / "manifest.json"
    if not manifest_path.is_file():
        return None
    manifest: dict[str, Any] = json.loads(manifest_path.read_text())
    frames: list[tuple[FrameRef, np.ndarray]] = []
    for item in manifest.get("items", []):
        file = str(item.get("file", ""))
        if not re.fullmatch(r"[\w.-]{1,100}\.png", file):
            continue
        image = cv2.imread(str(folder / file))
        if image is None:
            continue
        ts = float(item.get("ts", 0))
        until = float(item.get("until", ts + DEFAULT_FRAME_SECONDS))
        frames.append((FrameRef(ts=ts, file=file, seconds=max(until - ts, 0.0)), image))
    return frames
