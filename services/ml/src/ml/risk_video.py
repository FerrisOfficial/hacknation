"""Moduł 2, reguła 7 dla filmów: czy ostrzeżenie o ryzyku widać bez dodatkowego kliknięcia.

Film ogląda się bez klikania: kadr (OCR klatek), to, co pada w filmie (transkrypcja), tytuł i
początek opisu widoczny pod filmem przed „…więcej”. Reszta opisu wymaga rozwinięcia, więc
ostrzeżenie tylko tam to naruszenie (art. 44 ust. 2 lit. b i e rozporządzenia del. 2017/565).

Ostrzeżenia rozpoznajemy tymi samymi frazami co reguły wizualne (`risk_visual.is_warning`).
Bez transkrypcji i bez klatek nie wiemy, co jest w samym filmie — wtedy reguła daje `n/a`.
"""

import re
from dataclasses import dataclass

from ml.risk import _FEATURES, Finding
from ml.risk_visual import (
    _WARNING_MIN_WEIGHT,
    QUOTE_MAX,
    FrameText,
    _ts,
    frame_of,
    warning_lines,
)
from ml.scraper import normalize_text

# Ile znaków opisu YouTube pokazuje pod filmem przed „…więcej” (2-3 linie na komputerze;
# w aplikacji na telefonie opis jest w całości schowany, więc liczymy łagodnie).
DESCRIPTION_VISIBLE_CHARS = 150
QUOTE_CONTEXT = 120


@dataclass(frozen=True)
class VideoParts:
    title: str
    description: str
    transcript: str | None  # None = brak transkrypcji (nie wiadomo, co pada w filmie)


def _warning_at(text: str) -> re.Match[str] | None:
    """Pierwsze wyraźne ostrzeżenie o ryzyku w tekście."""
    matches = [
        m
        for pattern, weight in _FEATURES["risk_warning"]
        if weight >= _WARNING_MIN_WEIGHT
        for m in [pattern.search(text)]
        if m is not None
    ]
    return min(matches, key=lambda m: m.start(), default=None)


def _line_quote(text: str, match: re.Match[str]) -> str:
    """Linia tekstu z ostrzeżeniem, przycięta wokół niego (dosłowny fragment `text`)."""
    start = text.rfind("\n", 0, match.start()) + 1
    end = text.find("\n", match.end())
    end = len(text) if end == -1 else end
    if end - start > QUOTE_MAX:
        # Długa linia (transkrypcja to jedna linia): od początku zdania z ostrzeżeniem.
        sentence = text.rfind(". ", start, match.start())
        if sentence != -1 and match.start() - sentence <= QUOTE_CONTEXT:
            start = sentence + 2
        else:
            start = max(start, match.start() - QUOTE_CONTEXT)
        end = min(end, start + QUOTE_MAX)
    return text[start:end].strip()


def rule_7(video: VideoParts, frames: list[FrameText] | None) -> Finding:
    """Reguła 7 dla filmu. `frames`: tekst klatek z OCR; None albo [] = klatek nie mamy."""
    title = normalize_text(video.title)
    description = normalize_text(video.description)
    transcript = normalize_text(video.transcript) if video.transcript else None

    on_screen = warning_lines(frames) if frames else []
    if on_screen:
        frame, line = on_screen[0]
        reason = (
            f"Ostrzeżenie o ryzyku jest w kadrze filmu ({_ts(frame.ref.ts)}), "
            "widoczne bez klikania."
        )
        return Finding("7", "ok", 0.9, line.text[:QUOTE_MAX], reason, None, frame_of(frame, line))
    if transcript and (spoken := _warning_at(transcript)):
        reason = "Ostrzeżenie o ryzyku pada w filmie (transkrypcja), bez klikania."
        return Finding("7", "ok", 0.85, _line_quote(transcript, spoken), reason)
    if title_hit := _warning_at(title):
        reason = "Ostrzeżenie o ryzyku jest w tytule filmu."
        return Finding("7", "ok", 0.9, _line_quote(title, title_hit), reason)

    hit = _warning_at(description)
    if hit is None:
        reason = "Materiał nie zawiera ostrzeżenia o ryzyku (jego brak ocenia reguła 3)."
        return Finding("7", "n/a", 0.9, None, reason)
    quote = _line_quote(description, hit)
    if hit.start() < DESCRIPTION_VISIBLE_CHARS:
        reason = (
            f"Ostrzeżenie o ryzyku jest na początku opisu (znak {hit.start() + 1}), "
            "widocznym pod filmem przed „…więcej”."
        )
        return Finding("7", "ok", 0.7, quote, reason)

    checked = [
        name
        for name, known in (
            ("w transkrypcji", transcript is not None),
            ("na klatkach filmu", bool(frames)),
        )
        if known
    ]
    if not checked:
        reason = (
            "Ostrzeżenie jest tylko w rozwijanym opisie, ale brak transkrypcji i klatek: "
            "nie wiadomo, czy pada w samym filmie."
        )
        return Finding("7", "n/a", 0.0, quote, reason)
    missing = ""
    if not frames:
        missing = " Klatek filmu jeszcze nie sprawdzono."
    elif transcript is None:
        missing = " Film nie ma transkrypcji, więc mowy nie sprawdzono."
    reason = (
        f"Ostrzeżenie o ryzyku jest tylko w opisie, od znaku {hit.start() + 1}, za „…więcej”: "
        f"widz musi rozwinąć opis. Nie ma go {' ani '.join(checked)}.{missing}"
    )
    return Finding("7", "violation", 0.9 if len(checked) == 2 else 0.7, quote, reason)
