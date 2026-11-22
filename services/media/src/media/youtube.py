"""Pobranie filmu z YouTube przez yt-dlp: mp4 do 720p z dźwiękiem, do odtwarzania w Oknie sprawy."""

import re
import shutil
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from media.config import Settings


class MediaError(Exception):
    """Błąd z kodem HTTP dla klienta (backend rozróżnia 422 = nie ponawiaj i 502 = ponów)."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def canonical_url(url: str) -> str:
    """Adres filmu YouTube w jednej postaci. Inne adresy odrzucamy — yt-dlp pobrałby wszystko."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in _HOSTS:
        raise MediaError(422, "Obsługujemy tylko filmy z YouTube")
    if parsed.hostname == "youtu.be":
        video_id = parsed.path.strip("/")
    elif parsed.path.startswith("/shorts/"):
        video_id = parsed.path.removeprefix("/shorts/").strip("/")
    else:
        video_id = (parse_qs(parsed.query).get("v") or [""])[0]
    if not _VIDEO_ID.match(video_id):
        raise MediaError(422, "Nie rozpoznano identyfikatora filmu YouTube")
    return f"https://www.youtube.com/watch?v={video_id}"


def ffmpeg_location(ffmpeg: str) -> str | None:
    """Ścieżka do ffmpeg dla yt-dlp. yt-dlp traktuje `ffmpeg_location` jako ścieżkę, nie szuka
    samej nazwy („ffmpeg”) w PATH — wtedy uznaje, że ffmpeg nie ma. None = yt-dlp szuka w PATH."""
    return shutil.which(ffmpeg) or (ffmpeg if Path(ffmpeg).exists() else None)


def download_video(url: str, workdir: Path, settings: Settings) -> dict[str, Any]:
    """Pobiera film do `workdir/video.mp4`. Zwraca metadane yt-dlp (czas, rozdzielczość)."""
    height = settings.max_height
    try:
        with YoutubeDL(
            {
                # H.264 + AAC w mp4 odtworzy każda przeglądarka; dalej — cokolwiek do `height`.
                "format": (
                    f"bv*[height<={height}][vcodec^=avc1]+ba[acodec^=mp4a]/"
                    f"b[height<={height}][ext=mp4]/bv*[height<={height}]+ba/b[height<={height}]/b"
                ),
                "merge_output_format": "mp4",
                "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
                "outtmpl": str(workdir / "video.%(ext)s"),
                "ffmpeg_location": ffmpeg_location(settings.ffmpeg),
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "proxy": settings.proxy,
                "retries": 3,
                "socket_timeout": 30,
            }
        ) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise MediaError(502, "YouTube nie zwrócił danych filmu")
            duration = info.get("duration")
            if isinstance(duration, int | float) and duration > settings.max_duration_s:
                raise MediaError(
                    422,
                    f"Film trwa {int(duration)} s, limit to {settings.max_duration_s} s",
                )
            if info.get("is_live"):
                raise MediaError(422, "Transmisji na żywo nie pobieramy")
            ydl.process_ie_result(info, download=True)
    except DownloadError as exc:
        raise MediaError(502, f"Nie udało się pobrać filmu: {exc}") from exc
    if not (workdir / "video.mp4").is_file():
        raise MediaError(502, "yt-dlp nie zapisał pliku mp4")
    return dict(info)
