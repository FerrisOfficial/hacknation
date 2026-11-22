"""Katalog materiału na dysku: `<media_dir>/<material_id>/{video.mp4, <ts_ms>.png, manifest.json}`.

Katalog powstaje obok jako tymczasowy i dopiero gotowy (z manifestem) dostaje docelową nazwę,
więc czytelnik — backend albo warstwa AI — nigdy nie zobaczy połowy pobrania.
"""

import hashlib
import re
import shutil
import threading
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from media.config import Settings
from media.frames import build_items, extract_frames
from media.manifest import Manifest, Policy, VideoFile
from media.youtube import canonical_url, download_video

MANIFEST = "manifest.json"
VIDEO = "video.mp4"
_FRAME_FILE = re.compile(r"^\d{1,9}\.png$")

# Dwa żądania o ten sam film czekają na jedno pobranie zamiast pobierać go dwa razy.
_locks: defaultdict[UUID, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def material_dir(settings: Settings, material_id: UUID) -> Path:
    return settings.media_dir / str(material_id)


def read_manifest(settings: Settings, material_id: UUID) -> Manifest | None:
    path = material_dir(settings, material_id) / MANIFEST
    try:
        manifest = Manifest.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return manifest if (path.parent / VIDEO).is_file() else None


def video_path(settings: Settings, material_id: UUID) -> Path | None:
    if read_manifest(settings, material_id) is None:
        return None
    return material_dir(settings, material_id) / VIDEO


def frame_path(settings: Settings, material_id: UUID, file: str) -> Path | None:
    if not _FRAME_FILE.match(file):
        return None
    path = material_dir(settings, material_id) / file
    return path if path.is_file() else None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _dimension(info: dict[str, Any], key: str) -> int | None:
    value = info.get(key)
    return value if isinstance(value, int) and value > 0 else None


def fetch(settings: Settings, material_id: UUID, url: str) -> Manifest:
    """Pobiera film i wycina klatki. Gotowy materiał zwraca od razu, bez ponownego pobierania."""
    source_url = canonical_url(url)
    with _locks_guard:
        lock = _locks[material_id]
    with lock:
        existing = read_manifest(settings, material_id)
        if existing is not None:
            return existing

        settings.media_dir.mkdir(parents=True, exist_ok=True)
        workdir = settings.media_dir / f".{material_id}.{uuid4().hex}.tmp"
        workdir.mkdir()
        try:
            info = download_video(source_url, workdir, settings)
            video = workdir / VIDEO
            duration = info.get("duration")
            duration_s = float(duration) if isinstance(duration, int | float) else 0.0
            timestamps = extract_frames(video, workdir, settings)
            manifest = Manifest(
                material_id=material_id,
                source_url=source_url,
                duration_s=duration_s,
                width=_dimension(info, "width"),
                height=_dimension(info, "height"),
                video=VideoFile(size_bytes=video.stat().st_size, sha256=_sha256(video)),
                policy=Policy(
                    fps=settings.fps, max_frames=settings.max_frames, max_height=settings.max_height
                ),
                items=build_items(timestamps, duration_s),
                created_at=datetime.now(UTC),
            )
            (workdir / MANIFEST).write_text(
                manifest.model_dump_json(indent=2), encoding="utf-8", newline="\n"
            )
            target = material_dir(settings, material_id)
            # Katalog bez ważnego manifestu to resztka po przerwanym pobraniu.
            if target.exists():
                shutil.rmtree(target)
            workdir.rename(target)
            return manifest
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
