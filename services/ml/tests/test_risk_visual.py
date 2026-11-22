import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml.main import app
from ml.risk import Finding
from ml.risk_visual import FrameRef, evaluate_frames, is_historical, is_warning, load_frames

WARNING = "CFDs carry a high risk of losing money rapidly"

# cv2.putText nie rysuje polskich liter — ostrzeżenie po angielsku (te frazy też są w katalogu).


def frame(*texts: tuple[str, tuple[int, int], float, tuple[int, int, int], int]) -> np.ndarray:
    """Klatka 800x450, ciemne tło; tekst: (treść, (x, y), skala, kolor BGR, grubość)."""
    image = np.full((450, 800, 3), (40, 40, 40), np.uint8)
    for text, origin, scale, color, thickness in texts:
        cv2.putText(image, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)
    return image


def by_rule(frames: list[tuple[FrameRef, np.ndarray]]) -> dict[str, Finding]:
    return {f.rule_id: f for f in evaluate_frames(frames)}


# Reklama łamiąca reguły: ogromny wynik historyczny, ostrzeżenie małe, ciemne, na dole, 1 s.
BAD = frame(
    ("+142% w 2023!", (80, 170), 2.6, (255, 255, 255), 7),
    ("Otworz konto juz dzis", (80, 260), 1.0, (230, 230, 230), 2),
    (WARNING, (30, 432), 0.42, (75, 75, 75), 1),
)
# Reklama poprawna: duże, jasne ostrzeżenie w środku kadru, 8 s; wynik historyczny mały.
GOOD = frame(
    ("Otworz konto juz dzis", (60, 120), 1.6, (255, 255, 255), 4),
    (WARNING, (60, 230), 0.9, (255, 255, 255), 2),
    ("Wynik +8% w 2023", (60, 330), 0.6, (200, 200, 200), 1),
)


def test_line_classification() -> None:
    assert is_warning(WARNING)
    assert is_warning("74% rachunków inwestorów detalicznych traci pieniądze")
    assert not is_warning("Inwestuj z nami")
    assert is_historical("+142% w 2023!")
    assert not is_historical("Otwórz konto już dziś")


def test_bad_frame_violates_all_visual_rules() -> None:
    findings = by_rule([(FrameRef(ts=42.0, file="42000.png", seconds=1.0), BAD)])
    for rule in ("4", "5", "6", "8", "13"):
        finding = findings[rule]
        assert finding.result == "violation", (rule, finding.reason)
        assert finding.frame is not None and finding.frame["file"] == "42000.png"
    assert "+142%" in (findings["13"].quote or "")
    assert findings["6"].reason.startswith("Ostrzeżenie ukryte")
    assert all(len(str(f.confidence)) <= 5 for f in findings.values())  # bez artefaktów float32


def test_good_frame_passes() -> None:
    findings = by_rule([(FrameRef(ts=0.0, file="0.png", seconds=8.0), GOOD)])
    for rule in ("4", "5", "6", "8", "13"):
        assert findings[rule].result == "ok", (rule, findings[rule].reason)


def test_no_frames_and_no_warning() -> None:
    assert {f.result for f in evaluate_frames([])} == {"n/a"}
    plain = frame(("Otworz konto juz dzis", (80, 200), 1.2, (255, 255, 255), 3))
    findings = by_rule([(FrameRef(ts=0.0, file="0.png", seconds=5.0), plain)])
    assert {findings[r].result for r in ("4", "5", "6", "8", "13")} == {"n/a"}


@pytest.fixture
def media(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("MEDIA_DIR", str(tmp_path))
    folder = tmp_path / "film-1"
    folder.mkdir()
    cv2.imwrite(str(folder / "42000.png"), BAD)
    manifest = {"status": "done", "items": [{"ts": 42.0, "until": 43.0, "file": "42000.png"}]}
    (folder / "manifest.json").write_text(json.dumps(manifest))
    return tmp_path


def test_load_frames_reads_manifest_and_rejects_bad_ids(media: Path) -> None:
    frames = load_frames("film-1")
    assert frames is not None and len(frames) == 1
    assert frames[0][0] == FrameRef(ts=42.0, file="42000.png", seconds=1.0)
    assert load_frames("../etc") is None
    assert load_frames("brak") is None


def test_analyze_endpoint_adds_visual_findings_with_frame(media: Path) -> None:
    client = TestClient(app)
    response = client.post(
        "/analyze",
        json={"material_id": "film-1", "module": "risk_disclosure", "text": "Film o inwestowaniu"},
    )
    assert response.status_code == 200
    findings = {f["rule_id"]: f for f in response.json()["findings"]}
    assert findings["13"]["result"] == "violation"
    assert findings["13"]["frame"]["ts"] == 42.0
    assert findings["3"]["frame"] is None

    only_text = client.post(
        "/analyze",
        json={
            "material_id": "film-1",
            "module": "risk_disclosure",
            "text": "Film o inwestowaniu",
            "rules": ["3"],
        },
    )
    assert [f["rule_id"] for f in only_text.json()["findings"]] == ["3"]
