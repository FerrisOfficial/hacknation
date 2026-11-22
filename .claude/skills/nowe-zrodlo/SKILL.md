---
name: nowe-zrodlo
description: Dodanie nowego typu źródła lub platformy do silnika scrapingu (np. kolektor Facebook/TikTok/Instagram, RSS, nowy rodzaj wyszukiwania YouTube) — od kolektora w services/ml przez kolejkę pg-boss po dashboard. Użyj przy rozbudowie zbierania danych.
---

# Nowe źródło danych

Silnik jest jeden, kolektory są wymienne. Kolektor w Pythonie jest **bezstanowy**: dostaje konfigurację, zwraca JSON. Zapis do bazy, kolejkę, harmonogram i deduplikację robi backend w `apps/web`.

```
sources (Postgres) ──cron pg-boss co 1 min──▶ scheduler.ts ──▶ kolejka scrape ──▶ scrape.ts
     ──▶ @/lib/ml ──▶ FastAPI /collect/<platforma> ──▶ materials (+ treść w content-store) ──▶ kolejka analyze ──▶ M1/M2/M3 ──▶ Socket.io
```

## Kroki

1. **Kolektor** w `services/ml/src/ml/<platforma>.py`:
   - nagłówki z `pick_user_agent()` i proxy z `proxy_from_env()` (`ml/scraper.py`) — rotacja UA i proxy to wymaganie UKNF,
   - tekst przez `normalize_text`, hash treści do deduplikacji,
   - tempo: opóźnienie między żądaniami z env (wzór: `YOUTUBE_DELAY_S`), obsługa 429.
2. **Endpoint** `POST /collect/<platforma>` — skill `zmiana-api-ml` (pydantic, testy z fixture HTML/JSON, `pnpm api:generate`).
3. **Platforma** w bazie: enum `platform` w `packages/db/src/schema.ts` → skill `migracja-bazy`. Rozpoznanie domeny w `apps/web/src/lib/sources.ts`.
4. **Konfiguracja źródła**: nowy `kind` w schemacie Zod konfiguracji źródła i gałąź w `apps/web/src/lib/pipeline/scrape.ts` (wzór: `youtube_search`, `youtube_channel`).
5. **Materiały**: mapowanie wyniku kolektora na wiersze `materials` (wzór: `apps/web/src/lib/collect/youtube-materials.ts`) — `url` jest unikalny, `contentHash` z treści.
6. **UI**: ikona platformy w `apps/web/src/components/iw/icons.tsx`, etykieta i `ACTIVE_PLATFORMS` w `apps/web/src/lib/client/format.ts`, opcja w formularzu `zrodla/add-source.tsx`.
7. Testy jednostkowe mapowania (Vitest) i kolektora (pytest), potem `pnpm check`.
8. Sprawdź na żywo: dodaj źródło w zakładce Źródła („Nowe źródło”), w razie potrzeby „Ponów” → materiał w Kolejce w ciągu minuty.

## Zasady

- Tylko dane publiczne i open source. Żadnych płatnych API ani usług w chmurze (wymaganie UKNF).
- Regulamin platformy i `robots.txt`: zbieramy tyle, ile potrzeba do oceny reklamy, z umiarkowanym tempem.
- Nowa biblioteka → sprawdź licencję (kod przechodzi na UKNF) i dodaj przez `uv add`.
