---
name: przed-pr
description: Domknięcie zmiany i otwarcie pull requesta zgodnie z zasadami zespołu — check, przegląd diffu, recenzent AI, commit, push gałęzi, PR z szablonu. Użyj, gdy praca nad funkcją jest skończona albo użytkownik prosi o commit/PR.
---

# Przed PR

`main` jest chroniony: zmiany tylko przez PR z zielonym CI i akceptacją CODEOWNERS.
Jedna funkcja = jedna gałąź (`feat/…`, `fix/…`, `docs/…`, `chore/…`), merge w ciągu dnia.

## Kroki

1. **Aktualność:** `git fetch origin && git rebase origin/main`. Konflikt w `pnpm-lock.yaml` → `pnpm install`, w `uv.lock` → `uv lock`, w migracjach → skill `migracja-bazy`.
2. **Bramka jakości:**
   ```bash
   pnpm check
   ```
   Błędy formatowania: `pnpm format`. Nie wyciszaj błędów (`any`, `@ts-ignore`, `# type: ignore`) — napraw typ.
3. **Spójność generowanych plików** (to samo sprawdza CI):
   - zmiana w `services/ml/src` → `pnpm api:generate` i commit `packages/api-ml`,
   - zmiana w `packages/db/src/schema.ts` → migracja w `packages/db/drizzle`,
   - zmiana kształtu API → `docs/KONTRAKT.md` w tym samym PR.
4. **Przegląd diffu:** `git diff origin/main...` — tylko pliki z obszaru zadania (formatowanie „przy okazji” = konflikty u innych). Uruchom subagenta `recenzent` na diffie i popraw to, co zgłosi jako błąd.
5. **Commit:** po polsku, w trybie oznajmującym, co zmienia się dla użytkownika („M2: reguła 7 dla filmów”), nie „fix”.
6. **Push gałęzi i PR:**
   ```bash
   git push -u origin HEAD
   gh pr create --title "<tytuł jak commit>" --body "<opis według .github/pull_request_template.md>"
   ```
   Uzupełnij w opisie „Co i dlaczego” oraz checklistę. Przy zmianach modeli: wyniki ewaluacji przed i po.
7. Poczekaj na CI (`gh pr checks`). Czerwone CI naprawiasz na tej samej gałęzi, nowym commitem.

## Nie rób

- Push na `main`, force push, `--no-verify` — blokują je hooki (`.claude/hooks/chron-bash.mjs`, `.githooks/`).
- Merge własnego PR bez zielonego CI.
