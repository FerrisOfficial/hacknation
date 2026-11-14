# hacknation

Next.js 16 + FastAPI + Supabase w jednym monorepo (pnpm + Turborepo).

| Warstwa | Technologia |
|---|---|
| Frontend | Next.js (App Router), React 19, Tailwind 4, shadcn/ui, TanStack Query, React Hook Form + Zod |
| Backend | Route handlery i Server Actions w Next.js |
| Baza i auth | Supabase (Postgres + Auth), Drizzle ORM |
| ML | Python 3.14, FastAPI, pydantic, uv |
| Kontrakt TS ↔ Python | OpenAPI → `openapi-typescript` + `openapi-fetch` |
| Jakość | Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions |

## Pierwsze uruchomienie

**Wymagania:** Node 24, pnpm (`corepack enable`), [uv](https://docs.astral.sh/uv/getting-started/installation/), git.

```bash
pnpm install
cd services/ml && uv sync && cd ../..
cp apps/web/.env.example apps/web/.env.local
cp packages/db/.env.example packages/db/.env
pnpm dev
```

- http://localhost:3000 — aplikacja
- http://127.0.0.1:8000/docs — dokumentacja API serwisu ML

Przykład na stronie głównej przechodzi przez cały stack: formularz → `/api/predict` (Next.js) → FastAPI → wynik.

## Supabase (raz na zespół)

1. Załóżcie projekt na [supabase.com](https://supabase.com).
2. Project Settings → API: URL i *publishable key* wklejcie do `apps/web/.env.local`.
3. Connect → *Transaction pooler* → `DATABASE_URL` w `apps/web/.env.local`.
4. Connect → *Session pooler* → `DATABASE_URL` w `packages/db/.env`.
5. Tabele na produkcji tworzy workflow wdrożenia (niżej). Na własnej bazie deweloperskiej: `pnpm db:migrate`.

Bez Supabase aplikacja i serwis ML też działają, tylko bez logowania i bazy.

## Na co dzień

```bash
pnpm dev            # web + ml
pnpm check          # lint + typy + testy (TS i Python) — przed każdym PR
pnpm format         # auto-fix formatowania
pnpm db:generate    # po zmianie packages/db/src/schema.ts
pnpm db:check       # nie łączy się z bazą? pokaże kod błędu i co poprawić w .env
pnpm api:generate   # po zmianie endpointów w services/ml
```

## Praca w zespole

| Osoba | Obszar |
|---|---|
| 1 | `apps/web` — UI, strony, formularze |
| 2 | `apps/web/src/app/api` + `packages/db` — backend i baza |
| 3 | `services/ml` + `packages/api-ml` — ML |

- Gałąź na funkcję, krótkie PR-y, merge w ciągu dnia.
- Migracje bazy robi jedna osoba (2), żeby nie było konfliktów.
- Zasady dla agentów AI są w [CLAUDE.md](CLAUDE.md). Zmiany w nim przez osobny PR.

### Wdrożenie bazy (Supabase)

Migracje na produkcyjną bazę Supabase wdraża workflow **Deploy bazy (Supabase)**:
Actions → *Deploy bazy (Supabase)* → *Run workflow* (gałąź `main`).

- Uruchomić go może **tylko @FerrisOfficial**. U innych przerywa się od razu.
- Działa tylko z `main` i tylko wtedy, gdy CI na tym commicie jest zielone.
- Sekret `DATABASE_URL` (adres *Session pooler*) siedzi w środowisku `production`, ustawianym raz:

  ```bash
  gh secret set DATABASE_URL --env production --repo FerrisOfficial/hacknation
  ```

### Zasady na GitHubie

- `main` jest chroniony: zmiany tylko przez PR, wymagane zielone CI i **akceptacja @FerrisOfficial** (CODEOWNERS).
- Nowy push po akceptacji ją unieważnia, więc trzeba poprosić o ponowne review.
- Własne PR-y właściciel repo merguje z opcją *bypass*, bo GitHub nie pozwala zatwierdzić własnego PR-a.
