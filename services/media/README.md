# services/media

Serwis pobierania filmów (FastAPI + yt-dlp + ffmpeg). Pobiera film z YouTube, wycina klatki i oddaje
pliki. Analizy nie robi: klatki czyta warstwa AI (`services/ml`) ze wspólnego wolumenu `media`.
Plan i przebieg: [docs/KLATKI.md](../../docs/KLATKI.md).

```bash
uv sync
uv run uvicorn media.main:app --reload --reload-dir src --port 8100   # albo `pnpm dev` z roota
uv run pytest            # test z prawdziwym ffmpeg tylko, gdy jest w PATH albo FFMPEG_PATH
```

Lokalnie potrzebny jest `ffmpeg` (np. `brew install ffmpeg`) — w Dockerze jest w obrazie.

| Endpoint | Co robi |
|---|---|
| `POST /videos` `{ material_id, url }` | pobiera film (mp4 do 720p, H.264 + AAC), wycina klatki, zwraca manifest. Już pobrany: zwraca manifest od razu. 422 = nie ponawiaj (nie YouTube, za długi, live), 502 = ponów |
| `GET /videos/{material_id}` | manifest albo 404 |
| `GET /videos/{material_id}/video.mp4` | plik filmu z obsługą `Range` |
| `GET /videos/{material_id}/frames/{ts_ms}.png` | klatka |

Na dysku: `${MEDIA_DIR}/<material_id>/{video.mp4, <ts_ms>.png, manifest.json}`.

Zmienne: `MEDIA_DIR` (domyślnie `.data/media`), `MEDIA_MAX_DURATION_S` (1200), `MEDIA_MAX_HEIGHT` (720),
`MEDIA_FPS` (1), `MEDIA_MAX_FRAMES` (200), `FFMPEG_PATH` (`ffmpeg`), `SCRAPER_PROXY_URL`.
