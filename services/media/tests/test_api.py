from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from media import store
from media.config import Settings, get_settings
from media.main import app
from media.youtube import MediaError

MATERIAL = UUID("22222222-2222-4222-8222-222222222222")
URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
VIDEO_BYTES = bytes(range(256)) * 40


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        media_dir=tmp_path / "media",
        max_duration_s=600,
        max_height=720,
        fps=1.0,
        max_frames=200,
        ffmpeg="ffmpeg",
        proxy=None,
    )


@pytest.fixture
def downloads(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def fake_download(url: str, workdir: Path, _settings: Settings) -> dict[str, Any]:
        calls.append(url)
        (workdir / "video.mp4").write_bytes(VIDEO_BYTES)
        return {"duration": 12, "width": 1280, "height": 720}

    def fake_frames(_video: Path, out_dir: Path, _settings: Settings) -> list[float]:
        for ts in (0.0, 4.0, 9.0):
            (out_dir / f"{round(ts * 1000)}.png").write_bytes(b"\x89PNG")
        return [0.0, 4.0, 9.0]

    monkeypatch.setattr(store, "download_video", fake_download)
    monkeypatch.setattr(store, "extract_frames", fake_frames)
    return calls


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_pobiera_film_i_zapisuje_manifest(client: TestClient, downloads: list[str]) -> None:
    response = client.post("/videos", json={"material_id": str(MATERIAL), "url": URL})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "done"
    assert body["source_url"] == URL
    assert body["duration_s"] == 12
    assert body["video"]["size_bytes"] == len(VIDEO_BYTES)
    assert [(i["ts"], i["until"], i["file"]) for i in body["items"]] == [
        (0.0, 4.0, "0.png"),
        (4.0, 9.0, "4000.png"),
        (9.0, 12.0, "9000.png"),
    ]
    assert client.get(f"/videos/{MATERIAL}").json() == body


def test_drugie_zadanie_nie_pobiera_ponownie(client: TestClient, downloads: list[str]) -> None:
    for url in (URL, "https://youtu.be/jNQXAC9IVRw"):
        assert client.post("/videos", json={"material_id": str(MATERIAL), "url": url}).is_success
    assert downloads == [URL]


def test_film_z_obsluga_range(client: TestClient, downloads: list[str]) -> None:
    client.post("/videos", json={"material_id": str(MATERIAL), "url": URL})
    full = client.get(f"/videos/{MATERIAL}/video.mp4")
    assert full.status_code == 200
    assert full.headers["content-type"] == "video/mp4"
    assert full.content == VIDEO_BYTES
    part = client.get(f"/videos/{MATERIAL}/video.mp4", headers={"Range": "bytes=10-19"})
    assert part.status_code == 206
    assert part.content == VIDEO_BYTES[10:20]
    assert part.headers["content-range"] == f"bytes 10-19/{len(VIDEO_BYTES)}"


def test_klatki(client: TestClient, downloads: list[str]) -> None:
    client.post("/videos", json={"material_id": str(MATERIAL), "url": URL})
    frame = client.get(f"/videos/{MATERIAL}/frames/4000.png")
    assert frame.status_code == 200
    assert frame.headers["content-type"] == "image/png"
    for file in ("1234.png", "manifest.json", "video.mp4", "..%2Fmanifest.json"):
        assert client.get(f"/videos/{MATERIAL}/frames/{file}").status_code == 404


def test_brak_filmu_to_404(client: TestClient) -> None:
    assert client.get(f"/videos/{MATERIAL}").status_code == 404
    assert client.get(f"/videos/{MATERIAL}/video.mp4").status_code == 404
    assert client.get("/videos/nie-uuid").status_code == 422


def test_odrzuca_adres_spoza_youtube(client: TestClient, downloads: list[str]) -> None:
    response = client.post(
        "/videos", json={"material_id": str(MATERIAL), "url": "https://example.com/film.mp4"}
    )
    assert response.status_code == 422
    assert downloads == []


def test_blad_pobrania_nie_zostawia_resztek(
    client: TestClient, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing(_url: str, _workdir: Path, _settings: Settings) -> dict[str, Any]:
        raise MediaError(502, "Nie udało się pobrać filmu: HTTP 429")

    monkeypatch.setattr(store, "download_video", failing)
    response = client.post("/videos", json={"material_id": str(MATERIAL), "url": URL})
    assert response.status_code == 502
    assert "429" in response.json()["detail"]
    assert list(settings.media_dir.iterdir()) == []
