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

Wymagania: Docker z Compose v2 (Windows: Docker Desktop z WSL 2). Dashboard w obu trybach: **http://localhost:3000/hacknation**.

### Tryb szybki: dane demo, bez sieci i bez modelu

```bash
cp .env.example .env
docker compose up --build web
```

Pierwsza budowa obrazów trwa kilkanaście minut, kolejne starty kilkanaście sekund. Przy pierwszym starcie baza dostaje zbiór demo: 54 fikcyjne materiały (M1, M2, M3) z wynikami, dowodami i decyzjami analityka. Działają Przegląd, Kolejka, okno sprawy, Reklamy, Kalibracja (FP/FN od razu) i Źródła. Harmonogram jest wstrzymany, więc system nic nie pobiera z internetu. Włączysz go w zakładce Źródła.

### Tryb pełny: prawdziwe zbieranie i LLM

```bash
cp .env.example .env
# w .env: IVE_MODE=full, M2_ENGINE=hybrid, M3_ENGINE=hybrid
docker compose up --build
```

Na Linuksie i Macu zamiast edycji `.env`: `IVE_MODE=full M2_ENGINE=hybrid M3_ENGINE=hybrid docker compose up --build`.

Po starcie nic nie trzeba klikać:
1. `ollama-pull` pobiera Bielika-PL-11B (ok. 12 GB, raz, do wolumenu). Do końca pobierania M2 i M3 oceniają materiały samymi regułami.
2. Źródła M1 (frazy reklamowe dla marek z rejestru KNF) i M3 (frazy doradztwa) zakładają się same, a harmonogram od razu szuka w YouTube i na stronach z opisów filmów. Pierwsze materiały są w bazie po ok. minucie.
3. Nowe materiały przechodzą przez analizę. Wysokie ryzyko pojawia się jako powiadomienie na żywo.
4. Kalibracja działa od pierwszej minuty na zbiorze demo z decyzjami analityka, a nowe decyzje z Kolejki dochodzą do niego.

Tryb pełny potrzebuje internetu (YouTube, rejestr KNF). LLM liczy jedno zapytanie naraz, więc bez GPU analiza materiału trwa kilkadziesiąt sekund.

| Wymagania sprzętowe | Szybki | Pełny |
|---|---|---|
| GPU | niepotrzebne | zalecane NVIDIA z VRAM na model (Q8_0 ok. 12 GB); bez GPU działa na CPU, wolno |
| Dysk na model | 0 | ok. 12 GB (Q4_K_M: ok. 7 GB, [services/ml/README.md](services/ml/README.md)) |

| Wariant | Komenda / ustawienie |
|---|---|
| GPU NVIDIA | `docker compose -f compose.yaml -f compose.gpu.yaml up --build` |
| Ollama na hoście (Mac, GPU Apple) | `OLLAMA_URL=http://host.docker.internal:11434` w `.env` |
| Zmiana trybu albo reset danych | `docker compose down -v`, potem start od nowa. Tryb działa tylko przy pierwszym starcie na pustej bazie: baza z danymi zostaje bez zmian |

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
| Ruff, Pyright, Vitest, pytest | MIT |
| Biome | MIT lub Apache 2.0 |

## Dokumentacja

- [docs/ZADANIE.md](docs/ZADANIE.md): wymagania i kryteria oceny
- [docs/KONTRAKT.md](docs/KONTRAKT.md): API dashboardu, zdarzenia Socket.io, wyjście modeli
- [services/ml/README.md](services/ml/README.md): konfiguracja LLM
- [CLAUDE.md](CLAUDE.md), [docs/PROCES-AI.md](docs/PROCES-AI.md): zasady pracy zespołu i agentów AI
