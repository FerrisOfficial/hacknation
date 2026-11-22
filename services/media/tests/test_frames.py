import os
import shutil
import subprocess
from pathlib import Path

import pytest

from media.config import Settings
from media.frames import build_items, extract_frames
from media.youtube import MediaError, canonical_url, ffmpeg_location


def test_build_items_czas_na_ekranie_do_nastepnej_klatki() -> None:
    items = build_items([4.0, 0.0, 4.0, 9.5], duration_s=12.0)
    assert [(i.ts, i.until, i.file) for i in items] == [
        (0.0, 4.0, "0.png"),
        (4.0, 9.5, "4000.png"),
        (9.5, 12.0, "9500.png"),
    ]


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=42s",
        "https://youtube.com/watch?v=jNQXAC9IVRw",
        "https://m.youtube.com/watch?v=jNQXAC9IVRw",
        "https://youtu.be/jNQXAC9IVRw?si=abc",
        "https://www.youtube.com/shorts/jNQXAC9IVRw",
    ],
)
def test_canonical_url(url: str) -> None:
    assert canonical_url(url) == "https://www.youtube.com/watch?v=jNQXAC9IVRw"


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=jNQXAC9IVRw",
        "file:///etc/passwd",
        "https://www.youtube.com/watch?v=za-krotkie",
        "https://www.youtube.com/@kanal",
    ],
)
def test_canonical_url_odrzuca(url: str) -> None:
    with pytest.raises(MediaError) as error:
        canonical_url(url)
    assert error.value.status_code == 422


FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")


@pytest.mark.skipif(FFMPEG is None, reason="brak ffmpeg (FFMPEG_PATH albo w PATH)")
def test_extract_frames_tylko_zmiany_obrazu(tmp_path: Path) -> None:
    assert FFMPEG is not None
    video = tmp_path / "video.mp4"
    # 3 s czerwieni i 4 s błękitu: z 7 próbek zostają 2 klatki, w 0 s i 3 s.
    subprocess.run(
        [
            FFMPEG,
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=red:s=160x120:d=3,format=yuv420p",
            "-f",
            "lavfi",
            "-i",
            "color=blue:s=160x120:d=4,format=yuv420p",
            "-filter_complex",
            "[0][1]concat=n=2:v=1[v]",
            "-map",
            "[v]",
            "-r",
            "25",
            str(video),
        ],
        check=True,
    )
    settings = Settings(
        media_dir=tmp_path,
        max_duration_s=600,
        max_height=720,
        fps=2.0,
        max_frames=200,
        ffmpeg=FFMPEG,
        proxy=None,
    )
    assert extract_frames(video, tmp_path, settings) == [0.0, 3.0]
    assert sorted(path.name for path in tmp_path.glob("*.png")) == ["0.png", "3000.png"]


def test_ffmpeg_location_rozwiazuje_nazwe_z_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # yt-dlp bierze `ffmpeg_location` jako ścieżkę: sama nazwa „ffmpeg” = „ffmpeg is not installed”.
    exe = tmp_path / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    exe.write_text("")
    exe.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    assert Path(ffmpeg_location("ffmpeg") or "") == exe
    assert ffmpeg_location(str(exe)) == str(exe)
    monkeypatch.setenv("PATH", "")
    assert ffmpeg_location("ffmpeg") is None
