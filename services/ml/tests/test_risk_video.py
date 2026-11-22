from fastapi.testclient import TestClient

from ml.main import app
from ml.risk_video import DESCRIPTION_VISIBLE_CHARS, VideoParts, rule_7
from ml.risk_visual import (
    DEVICES,
    READABLE_MIN_PX,
    FrameRef,
    FrameText,
    TextLine,
    evaluate_texts,
)

WARNING = "Inwestowanie wiąże się z ryzykiem utraty kapitału."
FILLER = "Dzisiaj pokazuję, jak założyć konto i kupić pierwsze akcje. " * 5  # > 150 znaków
REF = FrameRef(ts=42.0, file="42000.png", seconds=5.0)


def line(text: str, height: float, y: float = 0.5) -> TextLine:
    return TextLine(text=text, box=(0.1, y, 0.9, y + height), height=height, contrast=7.0,
                    saliency=0.1)  # fmt: skip


def frame_text(*lines: TextLine, aspect: float = 16 / 9) -> FrameText:
    return FrameText(REF, list(lines), aspect)


# ─── Reguła 8: czytelność ostrzeżenia na różnych ekranach ─────────────────────────────────────


def rule_8(frame: FrameText) -> str:
    finding = next(f for f in evaluate_texts([frame]) if f.rule_id == "8")
    assert finding.frame is not None and finding.frame["file"] == "42000.png"
    return finding.result


def test_rule_8_small_warning_unreadable_on_phone() -> None:
    # 16:9 na telefonie: 375 / (16/9) = 211 px wysokości, 3% kadru = 6 px.
    small = frame_text(line("Otwórz konto", 0.1, 0.2), line(WARNING, 0.03, 0.9))
    assert rule_8(small) == "violation"
    finding = next(f for f in evaluate_texts([small]) if f.rule_id == "8")
    assert "telefon" in finding.reason and finding.quote == WARNING


def test_rule_8_large_warning_readable_everywhere() -> None:
    assert rule_8(frame_text(line(WARNING, 0.06))) == "ok"  # telefon: 13 px


def test_rule_8_vertical_video_fills_phone_screen() -> None:
    # Film pionowy (9:16) na telefonie ma 667 px wysokości: 3% kadru = 20 px.
    assert rule_8(frame_text(line(WARNING, 0.03), aspect=9 / 16)) == "ok"


def test_rule_8_thresholds_are_sane() -> None:
    phone = next(d for d in DEVICES if d[0] == "telefon")
    assert phone[1] == 375 and READABLE_MIN_PX == 9.0


# ─── Reguła 7: ostrzeżenie dostępne bez klikania ──────────────────────────────────────────────


def test_rule_7_warning_only_deep_in_description_is_violation() -> None:
    video = VideoParts("Jak kupić akcje", f"{FILLER}\n{WARNING}", "Cześć, dziś o akcjach.")
    no_warning_frame = frame_text(line("Otwórz konto", 0.1))
    finding = rule_7(video, [no_warning_frame])
    assert finding.result == "violation" and finding.confidence == 0.9
    assert finding.quote == WARNING
    assert "w transkrypcji ani na klatkach filmu" in finding.reason


def test_rule_7_without_frames_lower_confidence() -> None:
    video = VideoParts("Jak kupić akcje", f"{FILLER}\n{WARNING}", "Cześć, dziś o akcjach.")
    finding = rule_7(video, None)
    assert finding.result == "violation" and finding.confidence == 0.7
    assert "Klatek filmu jeszcze nie sprawdzono" in finding.reason


def test_rule_7_ok_when_warning_spoken_on_screen_or_early() -> None:
    spoken = VideoParts("Akcje", FILLER + WARNING, f"Pamiętajcie: {WARNING} A teraz akcje.")
    assert rule_7(spoken, None).result == "ok"
    assert rule_7(spoken, None).quote == f"Pamiętajcie: {WARNING} A teraz akcje."

    on_screen = VideoParts("Akcje", FILLER + WARNING, "Dziś o akcjach.")
    finding = rule_7(on_screen, [frame_text(line(WARNING, 0.05))])
    assert finding.result == "ok" and finding.frame is not None

    early = VideoParts("Akcje", WARNING + FILLER, "Dziś o akcjach.")
    assert len(WARNING) < DESCRIPTION_VISIBLE_CHARS
    assert rule_7(early, None).result == "ok"


def test_rule_7_not_applicable() -> None:
    assert rule_7(VideoParts("Akcje", FILLER, "Dziś o akcjach."), None).result == "n/a"
    # Bez transkrypcji i klatek nie wiadomo, co pada w filmie.
    unknown = rule_7(VideoParts("Akcje", FILLER + WARNING, None), None)
    assert unknown.result == "n/a" and unknown.quote == WARNING


def test_analyze_endpoint_rule_7_with_video_parts() -> None:
    client = TestClient(app)
    text = f"Jak kupić akcje\n\n{FILLER}\n{WARNING}\n\nCześć, dziś o akcjach."
    body = {
        "material_id": "brak-klatek",
        "module": "risk_disclosure",
        "text": text,
        "rules": ["3", "7"],
        "video": {
            "title": "Jak kupić akcje",
            "description": f"{FILLER}\n{WARNING}",
            "transcript": "Cześć, dziś o akcjach.",
        },
    }
    findings = {f["rule_id"]: f for f in client.post("/analyze", json=body).json()["findings"]}
    assert findings["7"]["result"] == "violation"
    assert findings["7"]["quote"] in text

    without_video = client.post("/analyze", json={**body, "video": None}).json()["findings"]
    assert next(f for f in without_video if f["rule_id"] == "7")["result"] == "n/a"
