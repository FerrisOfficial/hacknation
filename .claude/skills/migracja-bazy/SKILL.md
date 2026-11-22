---
name: migracja-bazy
description: Zmiana schematu PostgreSQL (nowa tabela, kolumna, indeks, enum) przez Drizzle z migracją w PR. Użyj zawsze, gdy edytujesz packages/db/src/schema.ts.
---

# Migracja bazy

Każdy ma własną lokalną bazę z `compose.yaml`. Zmiana dociera do innych tylko jako plik migracji, dlatego schemat zmieniamy wyłącznie migracją.

## Kroki

1. Zmień `packages/db/src/schema.ts`. Indeksy dla kolumn, po których filtruje dashboard (data, moduł, status, score).
2. Wygeneruj migrację:
   ```bash
   pnpm db:generate
   ```
   Powstanie `packages/db/drizzle/NNNN_<nazwa>.sql` i snapshot w `drizzle/meta/`. Przejrzyj SQL: czy nie ma `DROP` danych, których potrzebujemy do demo.
3. Nałóż lokalnie:
   ```bash
   pnpm db:migrate
   ```
   Błąd połączenia → `pnpm db:check` pokaże kod i podpowiedź.
4. Zaktualizuj zapytania (`apps/web/src/lib/queries`, `apps/web/src/lib/pipeline`) i typy, które z nich wynikają.
5. Jeśli kolumna trafia do API dashboardu, zaktualizuj `docs/KONTRAKT.md` i schematy Zod.
6. Migracja i snapshot idą w tym samym PR co zmiana schematu.

## Zakazy (pilnują ich hooki)

- `drizzle-kit push` — pomija migrację (hook `chron-bash`).
- Edycja istniejących plików w `packages/db/drizzle/` (hook `chron-pliki`). Błąd w migracji = nowa migracja, która go naprawia.
- `docker compose down -v` — kasuje zebrane dane do demo (hook `chron-bash`).

## Konflikt migracji z cudzą gałęzią

Dwie gałęzie z migracją o tym samym numerze: zrób rebase na `origin/main`, usuń **swoją** niezmergowaną migrację i snapshot, i uruchom `pnpm db:generate` jeszcze raz.
