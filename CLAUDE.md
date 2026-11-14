# hacknation — instrukcje dla agentów

Monorepo: Next.js (frontend + backend) + FastAPI (ML) + Supabase (Postgres, Auth).
Zespół 3 osób, każdy z własnym agentem. Piszemy tak, żeby PR-y się nie gryzły.

## Struktura

```
apps/web/          Next.js 16 — UI, route handlery (src/app/api), Server Actions
packages/db/       Drizzle — schemat bazy (src/schema.ts) i migracje (drizzle/)
packages/api-ml/   Typowany klient serwisu ML — GENEROWANY z OpenAPI, nie edytuj src/schema.d.ts
services/ml/       FastAPI + uv — modele ML, endpointy
```

Każdy katalog może mieć własny CLAUDE.md z zasadami lokalnymi (np. `apps/web/CLAUDE.md`).

## Komendy (z roota)

| Komenda | Co robi |
|---|---|
| `pnpm dev` | web (:3000) + ml (:8000) naraz |
| `pnpm check` | lint + typecheck + testy, TS i Python. **Uruchom przed każdym PR.** |
| `pnpm format` | auto-fix formatowania (Biome + Ruff) |
| `pnpm test:e2e` | build + Playwright |
| `pnpm env:pull` | pliki `.env` bazy dev ze zmiennych repo `DEV_WEB_ENV` / `DEV_DB_ENV` (`--force` nadpisuje) |
| `pnpm db:generate` | migracja SQL ze zmian w `packages/db/src/schema.ts` |
| `pnpm db:migrate` | zastosowanie migracji na bazie (najpierw sprawdza połączenie) |
| `pnpm db:check` | test połączenia z bazą z `packages/db/.env` — pokazuje kod błędu i podpowiedź |
| `pnpm api:generate` | OpenAPI z FastAPI → typy TS w `packages/api-ml` |

## Zasady

- **Po zmianie kodu uruchom `pnpm check` i napraw błędy, zanim uznasz zadanie za skończone.**
- TypeScript w trybie strict: żadnego `any`, `@ts-ignore` ani `as unknown as` dla wyciszenia błędu. Napraw typ.
- Python: type hints wszędzie, modele pydantic na wejściu i wyjściu endpointów.
- Nowe zależności: TS przez `pnpm add` w odpowiednim pakiecie, Python przez `uv add` w `services/ml`. Nie edytuj lockfile'ów ręcznie. Nie dodawaj biblioteki, jeśli to samo robi już coś ze stacku.
- Walidacja danych z zewnątrz: Zod (TS) / pydantic (Python). Nie ufaj body żądania.
- Przeglądarka nie woła FastAPI bezpośrednio. Ścieżka zawsze: komponent → route handler / Server Action → `@/lib/ml` → FastAPI.
- Zmiana API w `services/ml` = w tym samym PR `pnpm api:generate` i commit wygenerowanych plików (CI to sprawdza).
- Zmiana schematu bazy = w tym samym PR `pnpm db:generate` i commit migracji. Nie edytuj starych migracji.
- Każda nowa tabela w `packages/db/src/schema.ts` musi mieć `.enableRLS()`. Bez tego Supabase wystawia ją publicznie przez REST API.
- Na produkcyjną bazę migracje wdraża tylko właściciel repo, workflowem „Deploy bazy (Supabase)”. Nie uruchamiaj `pnpm db:migrate` z produkcyjnym `DATABASE_URL`.
- Sekrety tylko w `.env*` (ignorowane przez git). Nowa zmienna = dopisz ją do odpowiedniego `.env.example`.
- Zmienne repo `DEV_WEB_ENV` / `DEV_DB_ENV` zawierają hasło do bazy dev i nie są maskowane w logach. Nie używaj `vars.*` w workflowach i nigdy nie wrzucaj tam danych produkcyjnych.
- Auth zawsze przez Supabase (`@/lib/supabase/*`). Nie pisz własnej obsługi haseł ani sesji.
- Nie zmieniaj plików poza obszarem zadania (formatowanie "przy okazji" = konflikty u innych).

## Git

- `main` jest chroniony: zmiany tylko przez PR z zielonym CI.
- Gałęzie krótkie, jedna funkcja = jedna gałąź (`feat/…`, `fix/…`), merge w ciągu dnia.
- Konflikt w `pnpm-lock.yaml` → `pnpm install`, nie ręcznie. W `uv.lock` → `uv lock`.
