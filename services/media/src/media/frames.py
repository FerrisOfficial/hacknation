"""Klatki filmu do reguł wizualnych M2 (docs/KLATKI.md): ffmpeg, bez dodatkowych bibliotek.

`fps` klatek na sekundę, a filtr `mpdecimate` odrzuca klatki prawie takie same jak poprzednia —
zostają tylko zmiany obrazu. Czas wyświetlania klatki (`until`) to początek następnej, bo
obraz do tej chwili się nie zmienia. PNG, nie JPEG: kompresja rozmywa drobny tekst ostrzeżeń.
"""

import subprocess
from pathlib import Path

from media.config import Settings
from media.manifest import FrameItem
from media.youtube import MediaError


def frame_file(ts: float) -> str:
    return f"{round(ts * 1000)}.png"


def build_items(timestamps: list[float], duration_s: float) -> list[FrameItem]:
    ordered = sorted(set(timestamps))
    items: list[FrameItem] = []
    for index, ts in enumerate(ordered):
        until = ordered[index + 1] if index + 1 < len(ordered) else max(duration_s, ts)
        items.append(FrameItem(ts=ts, until=until, file=frame_file(ts)))
    return items


def extract_frames(video: Path, out_dir: Path, settings: Settings) -> list[float]:
    """Zapisuje klatki jako `<ts_ms>.png` w `out_dir`. Zwraca sekundy zapisanych klatek."""
    raw = out_dir / "_frames"
    raw.mkdir()
    command = [
        settings.ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-vf",
        f"fps={settings.fps},mpdecimate",
        "-fps_mode",
        "vfr",
        # Numer w nazwie pliku = pts klatki w jednostkach 1/fps, czyli numer kroku próbkowania.
        "-frame_pts",
        "1",
        "-frames:v",
        str(settings.max_frames),
        str(raw / "%d.png"),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=15 * 60)
    except FileNotFoundError as exc:
        raise MediaError(500, f"Brak ffmpeg ({settings.ffmpeg})") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", "replace").strip()[-500:]
        raise MediaError(502, f"ffmpeg nie wyciął klatek: {stderr}") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(502, "ffmpeg przekroczył czas wycinania klatek") from exc

    timestamps: list[float] = []
    for path in raw.glob("*.png"):
        ts = round(int(path.stem) / settings.fps, 3)
        path.rename(out_dir / frame_file(ts))
        timestamps.append(ts)
    raw.rmdir()
    return sorted(timestamps)
