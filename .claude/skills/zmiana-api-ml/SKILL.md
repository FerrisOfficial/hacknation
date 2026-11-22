---
name: zmiana-api-ml
description: Dodanie lub zmiana endpointu FastAPI w services/ml (np. nowy moduł analizy, nowe pole w /analyze) razem z typowanym klientem TS i route handlerem w Next.js. Użyj zawsze, gdy zmieniasz modele pydantic lub ścieżki w services/ml/src/ml/main.py.
---

# Zmiana API serwisu ML

Ścieżka danych jest jedna: komponent → route handler / Server Action → `@/lib/ml` → FastAPI.
Przeglądarka nigdy nie woła FastAPI bezpośrednio. Kształty wyjścia modelu opisuje `docs/KONTRAKT.md` §1–§3.

## Kroki

1. **Kontrakt najpierw.** Jeśli zmienia się kształt widoczny dla UI lub backendu (pola `details`, `flags`, `evidence`), zaktualizuj `docs/KONTRAKT.md` w tym samym PR. Kontrakt wygrywa z `docs/BACKEND.md`.
2. **Modele pydantic** w `services/ml/src/ml/main.py` (wejście i wyjście endpointu). Type hints wszędzie, `Field(description=...)` dla pól, które czyta UI.
3. **Logika** w osobnym module (`risk.py`, `advisory.py`, `youtube.py`…), a nie w `main.py`. Endpoint tylko waliduje i deleguje.
4. **Testy** w `services/ml/tests/test_<moduł>.py` oraz kontrakt HTTP w `test_api.py` (`TestClient`). Fixtures HTML w `tests/fixtures/`.
   ```bash
   cd services/ml && uv run pytest -q
   ```
5. **Wygeneruj klienta TS** (CI odrzuci PR bez tego — job „Kontrakt API”):
   ```bash
   pnpm api:generate
   ```
   Zmienią się `packages/api-ml/openapi.json` i `packages/api-ml/src/schema.d.ts`. Nie edytuj ich ręcznie (hook `chron-pliki` zablokuje).
6. **Klient w web:** funkcja w `apps/web/src/lib/ml.ts` używa typów z `@app/api-ml`. Wejście z zewnątrz waliduj Zodem (`apps/web/src/lib/schemas.ts`).
7. **Route handler** w `apps/web/src/app/api/**/route.ts` przez `handler()` z `@/lib/api/http`. Endpoint dla maszyn wymaga `requireCollectorToken`.
8. `pnpm check`, potem skill `przed-pr`.

## Pułapki

- Nowa zmienna środowiskowa serwisu ML → `services/ml/.env.example` **i** usługa `ml` w `compose.yaml`.
- Nowa zależność → `uv add <pakiet>` w `services/ml` (nie `pip install`). Sprawdź licencję: kod przechodzi na UKNF.
- Długie wywołania (LLM, Playwright) nie mogą blokować pętli — użyj `def` (wątek) albo `asyncio.to_thread`.
