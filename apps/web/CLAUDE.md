@AGENTS.md

# apps/web — Next.js (frontend + backend)

- Next.js 16 z App Router. Przed użyciem API, którego nie jesteś pewien, czytaj `node_modules/next/dist/docs/`.
- `cacheComponents` jest wyłączone. Nie włączaj go bez uzgodnienia z zespołem (zmienia renderowanie całej aplikacji) i nie używaj `'use cache'`, `cacheLife` ani `cacheTag`.
- "Middleware" to w Next 16 `src/proxy.ts`.
- Backend = route handlery (`src/app/api/**/route.ts`) i Server Actions. Osobnego serwera Node nie ma.
- Komponenty UI: shadcn/ui w `src/components/ui`. Nowe dodawaj przez `pnpm dlx shadcn@latest add <nazwa>`, nie pisz ich ręcznie.
- Formularze: React Hook Form + `zodResolver` + komponenty `Field*` z shadcn (wzór: `src/components/predict-form.tsx`).
- Schematy Zod trzymaj w `src/lib/schemas.ts`. Ten sam schemat waliduje formularz na kliencie i body w route handlerze.
- Pobieranie danych w komponentach klienta: TanStack Query (`useQuery` / `useMutation`).
- Serwis ML wołamy tylko z serwera przez `@/lib/ml` (typowany klient z `@app/api-ml`).
- Baza: `getDb()` z `@app/db` (lokalny Postgres z `compose.yaml`, `DATABASE_URL` w `.env.local`).
- Aplikacja działa tylko lokalnie: `pnpm dev` albo usługa `web` w `compose.yaml` (`output: "standalone"`). Nie dodawaj `export const runtime = "edge"`. Nowa zmienna środowiskowa = `apps/web/.env.example` i usługa `web` w `compose.yaml`.
- Aplikacja działa pod `/hacknation` (`basePath`, http://localhost:3000/hacknation). `<Link>` i router dodają prefiks same. W `fetch()` na własne API i w `src` obrazków z `public/` użyj `withBasePath()` z `@/lib/base-path` — gołe `"/api/..."` trafi poza aplikację.
