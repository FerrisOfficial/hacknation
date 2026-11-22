# hacknation

Next.js 16 + FastAPI + PostgreSQL w jednym monorepo (pnpm + Turborepo). Wszystko działa lokalnie, bez usług w chmurze.

| Warstwa | Technologia |
|---|---|
| Frontend | Next.js (App Router), React 19, Tailwind 4, shadcn/ui, TanStack Query, React Hook Form + Zod |
| Backend | Route handlery i Server Actions w Next.js |
| Baza | PostgreSQL 17 w Dockerze, Drizzle ORM |
| Uruchomienie | Docker Compose (on-premise), bez hostingu w chmurze |
| ML | Python 3.14, FastAPI, pydantic, uv |
| Kontrakt TS ↔ Python | OpenAPI → `openapi-typescript` + `openapi-fetch` |
| Jakość | Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions |

## Quick Start (Docker, cały stos on-premise)

**Wymagania:** [Docker](https://docs.docker.com/get-started/get-docker/) z Compose v2 (Windows: `winget install Docker.DockerDesktop`, backend WSL 2), ok. 15 GB wolnego dysku (obrazy + model), 16 GB RAM. GPU opcjonalne: NVIDIA z min. 6 GB VRAM.

```bash
cp .env.example .env   # albo pnpm install, który tworzy .env sam
docker compose up --build
```

Pierwszy start pobiera model `gemma4:e2b` do Ollamy (kilka GB). Kolejne starty używają wolumenu.

| Usługa | Adres | Co robi |
|---|---|---|
| `web` | http://localhost:3000/hacknation | Next.js — dashboard i API |
| `ml` | http://127.0.0.1:8000/docs | FastAPI — modele |
| `ollama` | http://127.0.0.1:11434 | lokalny LLM (model z `OLLAMA_MODEL` w `.env`) |
| `db` | 127.0.0.1:5432 | Postgres 17 — jedyna baza projektu |
| `migrate`, `ollama-pull` | — | jednorazowo: migracje Drizzle, pobranie modelu |

- Z kartą NVIDIA: `docker compose -f compose.yaml -f compose.gpu.yaml up --build`.
- Bez Ollamy (szybciej, gdy nie potrzebujesz LLM): `docker compose up --build web`.
- Od zera, z pustą bazą i bez modelu: `docker compose down -v`.
- Moduł 2 z LLM (Bielik-PL-11B, polski tokenizer APT4): `M2_ENGINE=hybrid` w `.env` — `ollama-pull` dociągnie ok. 12 GB. Domyślnie `rules` (sam regex, bez LLM). Mac i mniejsza wersja modelu: [services/ml/README.md](services/ml/README.md#modu%C5%82-2-informacja-o-ryzyku).
- Aplikacja działa bez logowania.

## Pierwsze uruchomienie (development)

**Wymagania:** Node 24, pnpm (`corepack enable`), [uv](https://docs.astral.sh/uv/getting-started/installation/), git, Docker (baza).

```bash
pnpm install        # tworzy brakujące .env z .env.example (gotowe wartości dla lokalnej bazy)
cd services/ml && uv sync && cd ../..
pnpm db:up          # Postgres z compose.yaml na 127.0.0.1:5432 + migracje
pnpm dev
```

- http://localhost:3000/hacknation — aplikacja
- http://127.0.0.1:8000/docs — dokumentacja API serwisu ML

Przykład na stronie głównej przechodzi przez cały stack: formularz → `/api/predict` (Next.js) → FastAPI → wynik.

Każdy ma **własną, prywatną bazę** (wolumen Dockera), wspólną dla `pnpm dev` i `docker compose up`. Od zera: `docker compose down -v`, potem `pnpm db:up`. Port 5432 zajęty przez inny Postgres? Zatrzymaj go albo zmień port w `compose.yaml` i w `DATABASE_URL`.

## Na co dzień

```bash
pnpm dev            # web + ml
pnpm check          # lint + typy + testy (TS i Python) — przed każdym PR
pnpm format         # auto-fix formatowania
pnpm db:up          # baza + migracje
pnpm db:generate    # po zmianie packages/db/src/schema.ts
pnpm db:migrate     # nakłada nowe migracje (np. po git pull)
pnpm db:check       # nie łączy się z bazą? pokaże kod błędu i co poprawić w .env
pnpm api:generate   # po zmianie endpointów w services/ml
pnpm audit          # znane podatności w zależnościach npm (CI sprawdza też Pythona przez pip-audit)
```

## Praca w zespole

| Osoba | Obszar |
|---|---|
| 1 | `apps/web` — UI, strony, formularze |
| 2 | `apps/web/src/app/api` + `packages/db` — backend i baza |
| 3 | `services/ml` + `packages/api-ml` — ML |

- Gałąź na funkcję, krótkie PR-y, merge w ciągu dnia.
- Migracje (`pnpm db:generate`) robi jedna osoba (2), żeby nie było konfliktów. Po `git pull` każdy nakłada je u siebie: `pnpm db:migrate`.
- Zasady dla agentów AI są w [CLAUDE.md](CLAUDE.md). Zmiany w nim przez osobny PR.

### Zasady na GitHubie

- `main` jest chroniony: zmiany tylko przez PR, wymagane zielone CI i **akceptacja @FerrisOfficial** (CODEOWNERS).
- Nowy push po akceptacji ją unieważnia, więc trzeba poprosić o ponowne review.
- Własne PR-y właściciel repo merguje z opcją *bypass*, bo GitHub nie pozwala zatwierdzić własnego PR-a.
