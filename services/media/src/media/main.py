"""Serwis media: pobiera filmy z YouTube, wycina klatki i oddaje pliki (docs/KLATKI.md).

Woła go tylko backend (kolejka `download-video` i route handlery), nigdy przeglądarka. Klatki
i manifest leżą na wolumenie `media`, który serwis ML ma podmontowany do odczytu.
"""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from media import store
from media.config import Settings, get_settings
from media.manifest import Manifest
from media.youtube import MediaError

app = FastAPI(title="InvestWatch media", version="0.1.0")

SettingsDep = Annotated[Settings, Depends(get_settings)]


class Health(BaseModel):
    status: str


class VideoRequest(BaseModel):
    material_id: UUID
    url: str = Field(min_length=1, max_length=2000)


@app.get("/health")
def health() -> Health:
    return Health(status="ok")


# Synchronicznie (FastAPI wykonuje `def` w puli wątków): pobranie trwa od kilku sekund do
# kilku minut, a backend czeka na wynik w zadaniu kolejki. 422 = nie ponawiaj, 502 = ponów.
@app.post("/videos", responses={422: {}, 502: {}})
def create_video(request: VideoRequest, settings: SettingsDep) -> Manifest:
    try:
        return store.fetch(settings, request.material_id, request.url)
    except MediaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.get("/videos/{material_id}", responses={404: {}})
def get_video(material_id: UUID, settings: SettingsDep) -> Manifest:
    manifest = store.read_manifest(settings, material_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="Film nie jest pobrany")
    return manifest


# Plik filmu z obsługą `Range` (przewijanie w <video>) — FileResponse w Starlette.
@app.get("/videos/{material_id}/video.mp4", response_class=FileResponse, responses={404: {}})
def get_video_file(material_id: UUID, settings: SettingsDep) -> FileResponse:
    path = store.video_path(settings, material_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Film nie jest pobrany")
    return FileResponse(path, media_type="video/mp4")


@app.get("/videos/{material_id}/frames/{file}", response_class=FileResponse, responses={404: {}})
def get_frame(material_id: UUID, file: str, settings: SettingsDep) -> FileResponse:
    path = store.frame_path(settings, material_id, file)
    if path is None:
        raise HTTPException(status_code=404, detail="Nie ma takiej klatki")
    return FileResponse(path, media_type="image/png")
