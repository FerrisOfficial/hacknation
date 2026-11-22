# hacknation — instrukcje dla agentów

Monorepo: Next.js (frontend + backend) + FastAPI (ML) + PostgreSQL. Wszystko działa lokalnie (Docker Compose), bez usług w chmurze.
Zespół 3 osób, każdy z własnym agentem. Piszemy tak, żeby PR-y się nie gryzły.

## Projekt

Robimy zadanie UKNF **#InvestWatch — na straży inwestorów!** (HackNation 2026): silnik scrapingu internetu i social mediów + 3 moduły AI (finfluencerzy reklamujący firmy inwestycyjne, brak informacji o ryzyku w reklamach, nieautoryzowane doradztwo) + dashboard z alertami i panelem kalibracji progu.
Oddanie: **22.11.2026, 11:00**.

Pełne wymagania, test jury i punktacja: [docs/ZADANIE.md](docs/ZADANIE.md). Przeczytaj przed decyzją produktową lub architektoniczną.
Kontrakt API (UI ↔ backend ↔ AI): [docs/KONTRAKT.md](docs/KONTRAKT.md). To źródło prawdy dla endpointów dashboardu, zdarzeń Socket.io i wyjścia modelu AI; przy sprzeczności z `docs/BACKEND.md` wygrywa kontrakt. Nie zmieniaj kształtów z kontraktu bez PR-a, który go aktualizuje.
Wymagania techniczne UKNF: Docker Compose on-premise, tylko open source, bez płatnych i zewnętrznych API. Nie dodawaj usług w chmurze (hosting, baza, auth, LLM).

## Struktura

```
apps/web/          Next.js 16 — UI, route handlery (src/app/api), Server Actions; http://localhost:3000/hacknation
packages/db/       Drizzle — schemat bazy (src/schema.ts) i migracje (drizzle/), Postgres z compose.yaml
packages/api-ml/   Typowany klient serwisu ML — GENEROWANY z OpenAPI, nie edytuj src/schema.d.ts
services/ml/       FastAPI + uv — modele ML, endpointy
services/media/    FastAPI + uv + ffmpeg — pobieranie filmów YouTube i klatek (dla Okna sprawy i M2)
compose.yaml       Cały stos on-premise w Dockerze: db (Postgres), migrate, ml, web, ollama (+ compose.gpu.yaml)
```

Każdy katalog może mieć własny CLAUDE.md z zasadami lokalnymi (np. `apps/web/CLAUDE.md`).

## Komendy (z roota)

| Komenda | Co robi |
|---|---|
| `pnpm db:up` | lokalna baza (Postgres z `compose.yaml`, port 5432) + migracje. Przed pierwszym `pnpm dev` |
| `pnpm dev` | web (:3000) + ml (:8000) + media (:8100) naraz; media potrzebuje lokalnie `ffmpeg` |
| `pnpm check` | lint + typecheck + testy, TS i Python. **Uruchom przed każdym PR.** |
| `pnpm format` | auto-fix formatowania (Biome + Ruff) |
| `pnpm test:e2e` | build + Playwright |
| `pnpm env:init` | tworzy brakujące `.env` z `.env.example` (robi to też `pnpm install`) |
| `pnpm db:generate` | migracja SQL ze zmian w `packages/db/src/schema.ts` |
| `pnpm db:migrate` | nakłada migracje na lokalną bazę |
| `pnpm db:check` | test połączenia z bazą z `packages/db/.env` — pokazuje kod błędu i podpowiedź |
| `pnpm api:generate` | OpenAPI z FastAPI → typy TS w `packages/api-ml` |
| `docker compose up --build` | cały stos w kontenerach; CI sprawdza go w jobie „Docker Compose” |

## Zasady

- **Po zmianie kodu uruchom `pnpm check` i napraw błędy, zanim uznasz zadanie za skończone.**
- TypeScript w trybie strict: żadnego `any`, `@ts-ignore` ani `as unknown as` dla wyciszenia błędu. Napraw typ.
- Python: type hints wszędzie, modele pydantic na wejściu i wyjściu endpointów.
- Nowe zależności: TS przez `pnpm add` w odpowiednim pakiecie, Python przez `uv add` w `services/ml`. Nie edytuj lockfile'ów ręcznie. Nie dodawaj biblioteki, jeśli to samo robi już coś ze stacku.
- Walidacja danych z zewnątrz: Zod (TS) / pydantic (Python). Nie ufaj body żądania.
- Przeglądarka nie woła FastAPI bezpośrednio. Ścieżka zawsze: komponent → route handler / Server Action → `@/lib/ml` → FastAPI.
- Zmiana API w `services/ml` = w tym samym PR `pnpm api:generate` i commit wygenerowanych plików (CI to sprawdza).
- Zmiana schematu bazy = w tym samym PR `pnpm db:generate` i commit migracji. Nie edytuj starych migracji.
- Baza to lokalny Postgres z `compose.yaml` — każdy ma własną, prywatną kopię (`docker compose down -v` ją czyści). Dane do demo trzeba zebrać na komputerze, z którego robimy demo.
- Nowa usługa lub zmienna środowiskowa potrzebna w działającym stosie = dopisz ją też do `compose.yaml` (sekrety przez `${...}` z `.env`, wzór w `.env.example` w roocie). Obrazy przypinamy do konkretnej wersji, bez `latest`.
- Schemat zmieniasz tylko migracją (`pnpm db:generate` + commit w PR), a nakładasz `pnpm db:migrate`. Nie używaj `drizzle-kit push` — inni muszą dostać tę samą zmianę jako migrację.
- Sekrety tylko w `.env*` (ignorowane przez git). Nowa zmienna = dopisz ją do odpowiedniego `.env.example`.
- Logowania na razie nie ma. Jeśli będzie potrzebne, uzgodnij z zespołem bibliotekę open source działającą lokalnie (np. Auth.js) — nie pisz własnej obsługi haseł ani sesji.
- Nie zmieniaj plików poza obszarem zadania (formatowanie "przy okazji" = konflikty u innych).

## Git

- `main` jest chroniony: zmiany tylko przez PR z zielonym CI.
- Gałęzie krótkie, jedna funkcja = jedna gałąź (`feat/…`, `fix/…`), merge w ciągu dnia.
- Konflikt w `pnpm-lock.yaml` → `pnpm install`, nie ręcznie. W `uv.lock` → `uv lock`.
