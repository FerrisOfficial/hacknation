# hacknation

Next.js 16 + FastAPI + Supabase w jednym monorepo (pnpm + Turborepo).

| Warstwa | Technologia |
|---|---|
| Frontend | Next.js (App Router), React 19, Tailwind 4, shadcn/ui, TanStack Query, React Hook Form + Zod |
| Backend | Route handlery i Server Actions w Next.js |
| Baza i auth | Supabase (Postgres + Auth), Drizzle ORM |
| Hosting | Cloudflare Workers (adapter OpenNext), wdrażane z GitHub Actions |
| ML | Python 3.14, FastAPI, pydantic, uv |
| Kontrakt TS ↔ Python | OpenAPI → `openapi-typescript` + `openapi-fetch` |
| Jakość | Biome, Ruff, Pyright, Vitest, pytest, Playwright, GitHub Actions |

## Pierwsze uruchomienie

**Wymagania:** Node 24, pnpm (`corepack enable`), [uv](https://docs.astral.sh/uv/getting-started/installation/), git, [GitHub CLI](https://cli.github.com) (`winget install GitHub.cli` / `brew install gh`).

```bash
gh auth login       # raz na komputer
pnpm install        # sam pobiera .env z danymi bazy (zmienne repo na GitHubie)
cd services/ml && uv sync && cd ../..
pnpm dev
```

Pliki `.env` pobiera `pnpm env:pull`. Uruchamia się samo po `pnpm install` i przy `pnpm dev`, jeśli pliku brakuje.
Bez `gh`: skopiuj `apps/web/.env.example` do `apps/web/.env.local` i `packages/db/.env.example` do `packages/db/.env`, a dane do bazy weź od właściciela repo.

- http://localhost:3000 — aplikacja
- http://127.0.0.1:8000/docs — dokumentacja API serwisu ML

Przykład na stronie głównej przechodzi przez cały stack: formularz → `/api/predict` (Next.js) → FastAPI → wynik.

## Supabase (raz na zespół)

Mamy **jedną bazę**: projekt Supabase `hacknation`. Lokalnie, na hostingu i w workflowie wdrożenia to ta sama baza.

1. Załóżcie projekt na [supabase.com](https://supabase.com).
2. Project Settings → API: URL i *publishable key* wklejcie do `apps/web/.env.local`.
3. Connect → *Transaction pooler* → `DATABASE_URL` w `apps/web/.env.local`.
4. Connect → *Session pooler* → `DATABASE_URL` w `packages/db/.env` i w sekrecie środowiska `production` (niżej).
5. Udostępnij dane zespołowi (każdy współpracownik dostanie je przez `pnpm env:pull`):

   ```bash
   gh variable set WEB_ENV < apps/web/.env.local
   gh variable set DB_ENV < packages/db/.env
   ```

   Po zmianie danych (np. hasła) powtórz to, a zespół niech uruchomi `pnpm env:pull --force`.

Tabele tworzy workflow wdrożenia (niżej), sam po każdym merge'u do `main`. Lokalnie `pnpm db:migrate` odmawia.

Zmienne repo (w przeciwieństwie do sekretów) każdy współpracownik może odczytać, ale w logach Actions nie są maskowane, więc nie używamy ich w workflowach.
Lokalny `.env` wskazuje na prawdziwą bazę, tę samą co demo: nie czyśćcie tabel i nie testujcie na niej niczego destrukcyjnego.
Gdy ktoś traci dostęp do repo, zresetuj hasło bazy (Project Settings → Database) i zaktualizuj `WEB_ENV`, `DB_ENV`, sekret `DATABASE_URL` i zmienne na hostingu.

Bez Supabase aplikacja i serwis ML też działają, tylko bez logowania i bazy.

## Na co dzień

```bash
pnpm dev            # web + ml
pnpm check          # lint + typy + testy (TS i Python) — przed każdym PR
pnpm format         # auto-fix formatowania
pnpm env:pull       # dane bazy do .env z GitHuba (--force nadpisuje istniejące)
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
- Migracje (`pnpm db:generate`) robi jedna osoba (2), żeby nie było konfliktów. Na bazę trafiają same po merge'u do `main`.
- Zasady dla agentów AI są w [CLAUDE.md](CLAUDE.md). Zmiany w nim przez osobny PR.

### Wdrożenie (Supabase + Cloudflare)

Workflow **Deploy (baza + aplikacja)** startuje sam, gdy CI na `main` skończy się na zielono, czyli po każdym merge'u, i wdraża dokładnie commit, który przeszedł CI:

1. migracje na bazę (Supabase),
2. aplikację Next.js na Cloudflare Workers (adapter OpenNext) — dopiero po udanych migracjach,
3. test `/api/health?db=1` na adresie `*.workers.dev`.

- Ręcznie (np. żeby ponowić): Actions → *Deploy (baza + aplikacja)* → *Run workflow* (gałąź `main`). Ręcznie może go uruchomić **tylko @FerrisOfficial**.
- Bez nowych migracji baza się nie zmienia.
- Serwis ML nie jest wdrażany, więc na produkcji `/api/predict` odpowiada 503.
- Build na Cloudflare nie działa na Windowsie (OpenNext), dlatego robi go CI. Każdy PR sprawdza też, czy Worker mieści się w 3 MiB (plan Free).

Sekrety w środowisku `production` (Settings → Environments → production), ustawiane raz:

| Sekret | Skąd |
|---|---|
| `DATABASE_URL` | Supabase → Connect → *Session pooler* (5432). Worker dostaje ten sam adres na porcie 6543. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → *Create Token* → szablon **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → *Account ID* w panelu bocznym |

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production --repo FerrisOfficial/hacknation
```

Konto Cloudflare musi mieć wybraną subdomenę `workers.dev` (Workers & Pages przy pierwszym wejściu). Po pierwszym wdrożeniu dopisz adres aplikacji w Supabase → Authentication → URL Configuration (*Site URL* i *Redirect URLs*).

### Zasady na GitHubie

- `main` jest chroniony: zmiany tylko przez PR, wymagane zielone CI i **akceptacja @FerrisOfficial** (CODEOWNERS).
- Nowy push po akceptacji ją unieważnia, więc trzeba poprosić o ponowne review.
- Własne PR-y właściciel repo merguje z opcją *bypass*, bo GitHub nie pozwala zatwierdzić własnego PR-a.
