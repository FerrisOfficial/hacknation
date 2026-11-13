@AGENTS.md

# apps/web — Next.js (frontend + backend)

- Next.js 16 z App Router i włączonym `cacheComponents`. Przed użyciem API, którego nie jesteś pewien, czytaj `node_modules/next/dist/docs/`.
- "Middleware" to w Next 16 `src/proxy.ts`.
- Backend = route handlery (`src/app/api/**/route.ts`) i Server Actions. Osobnego serwera Node nie ma.
- Komponenty UI: shadcn/ui w `src/components/ui`. Nowe dodawaj przez `pnpm dlx shadcn@latest add <nazwa>`, nie pisz ich ręcznie.
- Formularze: React Hook Form + `zodResolver` + komponenty `Field*` z shadcn (wzór: `src/components/predict-form.tsx`).
- Schematy Zod trzymaj w `src/lib/schemas.ts`. Ten sam schemat waliduje formularz na kliencie i body w route handlerze.
- Pobieranie danych w komponentach klienta: TanStack Query (`useQuery` / `useMutation`).
- Serwis ML wołamy tylko z serwera przez `@/lib/ml` (typowany klient z `@app/api-ml`).
- Supabase: `@/lib/supabase/server` w kodzie serwerowym, `@/lib/supabase/client` w `"use client"`.
