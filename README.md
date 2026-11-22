# IVE — InvestWatch

System monitoringu internetu dla UKNF (HackNation 2026, zadanie **#InvestWatch — na straży inwestorów!**). Sam wyszukuje materiały o usługach inwestycyjnych, ocenia je trzema modułami i pokazuje analitykowi alerty z dowodami. Działa w całości lokalnie, na Docker Compose.

## Uruchomienie

Wymagany jest tylko Docker z Compose v2. Dashboard: **http://localhost:3000/hacknation**

| | **Tryb szybki** (zalecany do oceny) | **Tryb pełny** |
|---|---|---|
| Komenda | `cp .env.example .env`<br>`docker compose up --build web` | `cp .env.example .env`<br>`IVE_MODE=full M2_ENGINE=hybrid M3_ENGINE=hybrid docker compose up --build` |
| Co widać | 54 przykładowe materiały M1, M2 i M3 z wynikami, dowodami i decyzjami analityka. Działają wszystkie zakładki, a Kalibracja od razu liczy FP/FN | to samo, a do tego prawdziwe zbieranie: źródła M1 i M3 zakładają się same i harmonogram od razu szuka w YouTube i na stronach WWW |
| Internet | niepotrzebny (harmonogram wstrzymany, włączysz go w zakładce Źródła) | potrzebny (YouTube, rejestr KNF) |
| Model AI | brak, M2 i M3 działają na regułach | Bielik-PL-11B w Ollamie, ok. 12 GB, pobierany raz |
| Sprzęt | bez GPU | zalecane GPU NVIDIA z ok. 12 GB VRAM; bez GPU działa na CPU, wolno |
| Pierwszy start | kilkanaście minut (budowa obrazów), potem kilkanaście sekund | jak w szybkim, plus pobranie modelu; do jego końca M2 i M3 działają na regułach |

Przykładowe materiały dotyczą wymyślonych firm z domenami `.example`. Tryb działa tylko przy pierwszym starcie na pustej bazie, więc baza z danymi zostaje bez zmian. Zmiana trybu: `docker compose down -v`, a potem start od nowa.

<details>
<summary>Windows, GPU, Ollama na hoście, development</summary>

- **Windows** (PowerShell): w `.env` ustaw `IVE_MODE=full`, `M2_ENGINE=hybrid`, `M3_ENGINE=hybrid` i uruchom `docker compose up --build`.
- **GPU NVIDIA:** `docker compose -f compose.yaml -f compose.gpu.yaml up --build`
- **Mac z GPU Apple:** uruchom Ollamę natywnie, a w `.env` ustaw `OLLAMA_URL=http://host.docker.internal:11434`. Mniejszy model Q4_K_M (ok. 7 GB) opisuje [services/ml/README.md](services/ml/README.md).
- **Development:** Node 24, pnpm, [uv](https://docs.astral.sh/uv/), ffmpeg:
  ```bash
  pnpm install && pnpm db:up && pnpm dev   # web :3000, ml :8000, media :8100
  pnpm check                               # lint + typy + testy (TS i Python)
  ```
</details>

## Co robi

| Moduł | Szuka | Jak ocenia |
|---|---|---|
| **Silnik zbierania** | wyszukiwanie i kanały YouTube (opisy, transkrypcje, klatki), strony WWW z linków pod filmami, rejestr i lista ostrzeżeń KNF | harmonogram w kolejce pg-boss, deduplikacja po hashu treści, opcjonalne proxy i losowe przerwy |
| **M1 — finfluencerzy** | reklam firm z rejestru KNF publikowanych przez osoby trzecie | reguły (marka, kod polecający, zachęta); kanał z reklamą jest potem obserwowany na stałe |
| **M2 — informacja o ryzyku** | materiałów firm z rejestru KNF | 18 reguł UKNF (art. 44 rozp. 2017/565), każda z cytatem albo klatką filmu jako dowodem; reguły wizualne (czcionka, kontrast, czas ekspozycji) liczone z OCR klatek; w trybie `hybrid` naruszenia ocenia Bielik |
| **M3 — nieautoryzowane doradztwo** | ofert doradztwa (art. 76 u.o.o.i.f.) od podmiotów bez zezwolenia KNF | przesłanki z reguł łączy funkcja logistyczna z wagami ustalonymi ręcznie (nietrenowana, do kalibracji na danych UKNF); w trybie `hybrid` werdykt wydaje Bielik |

**Dashboard:** kolejka incydentów z filtrami (data, źródło, ryzyko, moduł), zmiana statusu, trend, teczka podmiotu, okno sprawy (film, klatki, kopia HTML), raporty i powiadomienia o wysokim ryzyku na żywo (Socket.io). **Kalibracja:** próg dla każdego modułu, a jego zmiana od razu przelicza FP/FN, precyzję i pełność na decyzjach analityka.

## Wymagania techniczne UKNF

| Wymaganie | Jak spełniamy |
|---|---|
| Lekkie, rozdzielone serwisy | Osobne kontenery: `web` (UI i backend), `ml` (AI i scraping), `media` (filmy), `ollama` (LLM), `db`. `web` woła `ml` przez klient generowany z OpenAPI. Przeglądarka nie woła serwisów AI bezpośrednio. |
| Docker Compose, on-premise | Jedna komenda, obrazy z przypiętymi wersjami. CI w każdym PR buduje stos i sprawdza, czy odpowiada. |
| Tylko open source, bez płatnych API | Bielik w lokalnej Ollamie, OCR w ONNX Runtime, Postgres. Nie ma kluczy do zewnętrznych usług. |
| Bezpieczny łańcuch dostaw | CI uruchamia `pnpm audit` i `pip-audit`, lockfile'y są wymuszane. Sekrety trzymamy tylko w `.env` (poza gitem i obrazami), porty wystawiamy tylko na `127.0.0.1`. |
| README minimalne | Uruchomienie, wymagania sprzętowe i usługi na jednym ekranie. |

## Usługi i stack

| Usługa | Port | Technologie |
|---|---|---|
| `web` | 3000, 3001 (Socket.io) | Next.js 16, React 19, Tailwind 4, shadcn/ui, TanStack Query, Zod, pg-boss, Drizzle |
| `ml` | 8000 (`/docs`) | Python 3.14, FastAPI, pydantic, httpx, selectolax, Playwright, yt-dlp, RapidOCR |
| `media` | 8100 | FastAPI, yt-dlp, ffmpeg |
| `ollama` | 11434 | Ollama + Bielik-PL-11B v3.0 (tylko w trybie pełnym) |
| `db` | 5432 | PostgreSQL 17: metadane, treści, wyniki, decyzje |

Jakość kodu: Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions. Zmienne z opisami: [.env.example](.env.example).

```
apps/web/          Next.js: UI, API (src/app/api), pipeline i kolejka (src/lib)
packages/db/       schemat Drizzle i migracje SQL
packages/api-ml/   klient TS serwisu ML generowany z OpenAPI
services/ml/       FastAPI: scraper, kolektory, M2 (risk*.py), M3 (advisory.py), KNF (knf.py)
services/media/    FastAPI + ffmpeg: filmy i klatki
docs/              wymagania (ZADANIE.md), kontrakt API (KONTRAKT.md), materiały UKNF
```

## Licencja

Kod projektu: [MIT](LICENSE). Wszystkie zależności są open source. Kod linkuje tylko biblioteki na licencjach permisywnych, a ffmpeg (GPL) działa jako osobny program.

<details>
<summary>Licencje zależności</summary>

| Komponent | Licencja |
|---|---|
| Next.js, React, Tailwind CSS, shadcn/ui, Base UI, TanStack Query, React Hook Form, @hookform/resolvers, Zod, Socket.io, pg-boss, sonner, next-themes, fflate, tw-animate-css, cn, openapi-fetch, openapi-typescript | MIT |
| class-variance-authority, Drizzle ORM | Apache 2.0 |
| lucide-react | ISC |
| Inter (@fontsource-variable/inter) | SIL OFL 1.1 |
| postgres (postgres.js), yt-dlp | Unlicense |
| FastAPI, pydantic, selectolax, youtube-transcript-api, ONNX Runtime, Ollama | MIT |
| httpx, Chromium (headless shell w obrazie `ml`) | BSD-3-Clause |
| Playwright, RapidOCR, Bielik-PL-11B v3.0 Instruct (SpeakLeash) | Apache 2.0 |
| ffmpeg (pakiet Debiana w obrazie `media`, osobny proces) | GPL 2+ |
| PostgreSQL | PostgreSQL License |
| Obrazy bazowe `node`, `python`, `postgres`, `ollama/ollama` | licencje projektów + pakiety Debiana |
| Ruff, Pyright, Vitest, pytest | MIT |
| Biome | MIT lub Apache 2.0 |
</details>

Więcej: [docs/ZADANIE.md](docs/ZADANIE.md) (wymagania), [docs/KONTRAKT.md](docs/KONTRAKT.md) (API), [docs/PROCES-AI.md](docs/PROCES-AI.md) (jak pracowaliśmy z agentami AI).
