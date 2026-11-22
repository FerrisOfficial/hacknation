"""Ustawienia serwisu z env. Wartości domyślne pasują do `pnpm dev` (katalog `.data/media`)."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    # Katalog z filmami i klatkami: `<media_dir>/<material_id>/`. W compose wolumen `media`,
    # podmontowany też do serwisu ML (tylko do odczytu) — stąd warstwa AI czyta klatki.
    media_dir: Path
    # Dłuższych filmów nie pobieramy (422): reklamy i shortsy finfluencerów mieszczą się z zapasem.
    max_duration_s: int
    # Najwyższa rozdzielczość pobieranego filmu. 720p wystarcza do odczytu tekstu z ekranu.
    max_height: int
    # Ile klatek na sekundę filmu analizujemy i ile unikalnych klatek zapisujemy najwyżej.
    fps: float
    max_frames: int
    ffmpeg: str
    proxy: str | None


def _int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def _float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


@lru_cache
def get_settings() -> Settings:
    return Settings(
        media_dir=Path(os.environ.get("MEDIA_DIR") or ".data/media").resolve(),
        max_duration_s=_int("MEDIA_MAX_DURATION_S", 20 * 60),
        max_height=_int("MEDIA_MAX_HEIGHT", 720),
        fps=_float("MEDIA_FPS", 1.0),
        max_frames=_int("MEDIA_MAX_FRAMES", 200),
        ffmpeg=os.environ.get("FFMPEG_PATH") or "ffmpeg",
        proxy=os.environ.get("SCRAPER_PROXY_URL") or None,
    )
