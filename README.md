# IVE — InvestWatch

System monitoringu internetu dla UKNF (zadanie **#InvestWatch — na straży inwestorów!**, HackNation 2026). Sam wyszukuje i zbiera materiały o usługach inwestycyjnych, ocenia je trzema modułami analitycznymi (M1 na regułach, M2 i M3 na regułach z opcjonalnym LLM) i pokazuje analitykowi alerty z dowodami.

## Funkcjonalności

- **Silnik zbierania:** wyszukiwanie i kanały YouTube (opisy, transkrypcje, klatki filmów), strony WWW z linków pod filmami, rejestr i lista ostrzeżeń KNF. Harmonogram w kolejce pg-boss, deduplikacja po hashu treści, opcjonalny proxy i losowe przerwy między zapytaniami.
- **M1 — finfluencerzy:** reklamy firm z rejestru KNF publikowane przez osoby trzecie. Kanał, w którym znaleziono reklamę, jest potem obserwowany na stałe.
- **M2 — informacja o ryzyku:** 18 reguł UKNF (art. 44 rozp. 2017/565) dla materiałów firm z rejestru KNF. Każde naruszenie ma cytat albo klatkę filmu jako dowód. Reguły wizualne (rozmiar czcionki, kontrast, czas ekspozycji ostrzeżenia) liczone są z OCR klatek.
- **M3 — nieautoryzowane doradztwo:** przesłanki doradztwa inwestycyjnego (art. 76 u.o.o.i.f.) u podmiotów bez zezwolenia KNF. Prawdopodobieństwo liczy regresja logistyczna, a w trybie `hybrid` werdykt wydaje LLM.
- **Dashboard:** kolejka incydentów z filtrami (data, źródło, ryzyko, moduł), zmiana statusu, trend incydentów, teczka podmiotu, okno sprawy (film, klatki, kopia HTML), raporty, powiadomienia o wysokim ryzyku na żywo (Socket.io).
- **Kalibracja:** próg ryzyka dla każdego modułu. Jego zmiana od razu przelicza FP/FN na decyzjach analityka.

## Quick Start

**Wymagania:** Docker z Compose v2 (Windows: Docker Desktop z WSL 2).

| Tryb | Model | Sprzęt |
|---|---|---|
| `rules` (domyślny) | brak | bez GPU; tylko obrazy kontenerów |
| `hybrid` | Bielik-PL-11B Q8_0, ok. 12 GB dysku | najlepiej GPU NVIDIA z VRAM na cały model, bez GPU działa na CPU (wolno); mniej pamięci: kwantyzacja Q4_K_M ok. 7 GB ([services/ml/README.md](services/ml/README.md)) |

```bash
cp .env.example .env
docker compose up --build
```

Dashboard: http://localhost:3000/hacknation. Domyślnie M2 i M3 działają na regułach (`M2_ENGINE=rules`, `M3_ENGINE=rules`) i stos nie pobiera modelu.

| Wariant | Komenda / ustawienie |
|---|---|
| Z LLM (Bielik-PL-11B, ok. 12 GB, pobierany raz do wolumenu) | `M2_ENGINE=hybrid`, `M3_ENGINE=hybrid` w `.env` |
| GPU NVIDIA | `docker compose -f compose.yaml -f compose.gpu.yaml up --build` |
| Bez Ollamy | `docker compose up --build web` |
| Reset bazy i modelu | `docker compose down -v` |
| Ollama na hoście (Mac, GPU Apple) | `OLLAMA_URL=http://host.docker.internal:11434` |

### Usługi

| Usługa | Adres | Rola |
|---|---|---|
| `web` | :3000, :3001 (Socket.io) | Next.js: dashboard, API, kolejka i harmonogram (pg-boss), powiadomienia na żywo |
| `ml` | :8000/docs | FastAPI: scraper, kolektory YouTube i KNF, moduły M2 i M3, OCR |
| `media` | :8100 | FastAPI + ffmpeg: pobieranie filmów i wycinanie klatek |
| `ollama` | :11434 | lokalny LLM dla trybu `hybrid` |
| `db` | :5432 | PostgreSQL 17: metadane, wyniki, decyzje analityka |
| `migrate`, `ollama-pull` | — | jednorazowo: migracje Drizzle, pobranie modelu |

Wszystkie porty są wystawione tylko na `127.0.0.1`. Główne zmienne z opisami: [.env.example](.env.example).

### Development (bez kontenerów aplikacji)

Wymagania: Node 24, pnpm (`corepack enable`), [uv](https://docs.astral.sh/uv/), ffmpeg, Docker (baza).

```bash
pnpm install         # tworzy brakujące .env z .env.example
pnpm db:up           # Postgres + migracje
pnpm dev             # web :3000, ml :8000, media :8100
pnpm check           # lint + typy + testy (TS i Python)
```

## Stack

| Warstwa | Technologie |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui (Base UI), TanStack Query, React Hook Form + Zod |
| Backend | Route handlery Next.js, pg-boss (kolejka i cron), Socket.io, Drizzle ORM |
| AI / scraping | Python 3.14, FastAPI, pydantic, httpx, selectolax, Playwright, yt-dlp, RapidOCR (ONNX Runtime), Ollama + Bielik-PL-11B |
| Dane | PostgreSQL 17 (metadane i treść), wolumen plików (kopie HTML, filmy, klatki) |
| Kontrakt TS ↔ Python | OpenAPI → `openapi-typescript` + `openapi-fetch` ([docs/KONTRAKT.md](docs/KONTRAKT.md)) |
| Jakość | Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions |

## Struktura

```
apps/web/          Next.js: UI (src/app/(app)), API (src/app/api), pipeline i kolejka (src/lib)
packages/db/       schemat Drizzle (src/schema.ts) i migracje SQL (drizzle/)
packages/api-ml/   klient TS serwisu ML generowany z OpenAPI
services/ml/       FastAPI: scraper, kolektory, M2 (risk*.py), M3 (advisory.py), KNF (knf.py)
services/media/    FastAPI + ffmpeg: filmy i klatki
docs/              wymagania (ZADANIE.md), kontrakt API, materiały UKNF
compose.yaml       cały stos on-premise (+ compose.gpu.yaml)
```

## Wymagania techniczne UKNF

| Wymaganie | Jak spełniamy |
|---|---|
| Lekkie, rozdzielone serwisy | Frontend z backendem (`web`), AI (`ml`), media (`media`), LLM (`ollama`) i baza (`db`) to osobne kontenery. `web` woła `ml` przez klient generowany z OpenAPI, a `media` przez HTTP z walidacją Zod. Przeglądarka nie woła serwisów AI bezpośrednio. |
| Docker Compose, on-premise | Cały stos startuje jedną komendą `docker compose up --build`. Obrazy mają przypięte wersje. CI w każdym PR buduje stos bez Ollamy (db, migrate, ml, media, web) i sprawdza, czy odpowiada. |
| Tylko open source, bez płatnych API | Model Bielik działa lokalnie w Ollamie, OCR lokalnie w ONNX Runtime, baza to Postgres. Nie ma kluczy do zewnętrznych usług. Bez LLM system działa na regułach. |
| Bezpieczny łańcuch dostaw | CI uruchamia `pnpm audit --audit-level high` i `pip-audit` (ml, media), a lockfile'y są wymuszane (`--frozen-lockfile`, `uv sync --locked`). Sekrety trzymamy tylko w `.env` (poza gitem i obrazami), a porty wystawiamy tylko na localhost. |
| README minimalne | Ten plik: Quick Start, wymagania sprzętowe, konfiguracja usług. |

## Licencja

Kod projektu: [MIT](LICENSE).

### Licencje zależności

Wszystkie zależności są open source. Kod projektu linkuje tylko biblioteki na licencjach permisywnych, a ffmpeg (GPL) działa jako osobny program.

| Komponent | Licencja |
|---|---|
| Next.js, React, Tailwind CSS, shadcn/ui, Base UI, TanStack Query, React Hook Form, @hookform/resolvers, Zod, Socket.io, pg-boss, sonner, next-themes, fflate, tw-animate-css, cn, openapi-fetch, openapi-typescript | MIT |
| class-variance-authority | Apache 2.0 |
| lucide-react | ISC |
| Inter (@fontsource-variable/inter) | SIL OFL 1.1 |
| Drizzle ORM | Apache 2.0 |
| postgres (postgres.js) | Unlicense |
| FastAPI, pydantic, selectolax, youtube-transcript-api, ONNX Runtime | MIT |
| httpx | BSD-3-Clause |
| Playwright, RapidOCR | Apache 2.0 |
| Chromium (headless shell, w obrazie `ml`) | BSD-3-Clause |
| yt-dlp | Unlicense |
| ffmpeg (pakiet Debiana w obrazie `media`, osobny proces, bez linkowania) | GPL 2+ |
| PostgreSQL | PostgreSQL License |
| Ollama | MIT |
| Obrazy bazowe: `node`, `python` (Debian), `postgres`, `ollama/ollama` | licencje projektów (MIT, PSF, PostgreSQL, MIT) + pakiety Debiana |
| Bielik-PL-11B v3.0 Instruct (SpeakLeash) | Apache 2.0 |
| Biome, Ruff, Pyright, Vitest, pytest | MIT |

## Dokumentacja

- [docs/ZADANIE.md](docs/ZADANIE.md): wymagania i kryteria oceny
- [docs/KONTRAKT.md](docs/KONTRAKT.md): API dashboardu, zdarzenia Socket.io, wyjście modeli
- [services/ml/README.md](services/ml/README.md): konfiguracja LLM
- [CLAUDE.md](CLAUDE.md), [docs/PROCES-AI.md](docs/PROCES-AI.md): zasady pracy zespołu i agentów AI
