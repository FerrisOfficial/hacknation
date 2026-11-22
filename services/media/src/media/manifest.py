"""Manifest pobranego filmu: `<media_dir>/<material_id>/manifest.json`.

Ten sam kształt backend zapisuje w `materials.metadata.frames` (docs/KONTRAKT.md §1), a warstwa AI
czyta go z dysku po `material_id`, żeby znaleźć klatki dla reguł wizualnych M2 (docs/KLATKI.md).
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class FrameItem(BaseModel):
    # Sekunda pierwszego pokazania klatki i do kiedy obraz się nie zmienia (czas na ekranie).
    ts: float = Field(ge=0)
    until: float = Field(ge=0)
    # Nazwa pliku w katalogu materiału: `<ts w ms>.png`.
    file: str


class VideoFile(BaseModel):
    file: Literal["video.mp4"] = "video.mp4"
    content_type: Literal["video/mp4"] = "video/mp4"
    size_bytes: int = Field(ge=0)
    # SHA-256 pliku: dowód niezmienności kopii (R4), jak hash kopii HTML stron WWW.
    sha256: str


class Policy(BaseModel):
    fps: float
    max_frames: int
    max_height: int


class Manifest(BaseModel):
    material_id: UUID
    status: Literal["done"] = "done"
    # Kanoniczny adres filmu, z którego pobraliśmy kopię.
    source_url: str
    duration_s: float = Field(ge=0)
    width: int | None
    height: int | None
    video: VideoFile
    policy: Policy
    items: list[FrameItem]
    created_at: datetime
