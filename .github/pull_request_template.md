## Co i dlaczego

<!-- 1–3 zdania. Link do zadania, jeśli jest. -->

## Jak sprawdzone

<!-- Testy, ręczna weryfikacja w UI, wynik ewaluacji przed/po dla zmian w modułach AI. -->

## Checklista

- [ ] `pnpm check` przechodzi lokalnie
- [ ] Zmieniłem/am API w `services/ml` → uruchomiłem/am `pnpm api:generate`
- [ ] Zmieniłem/am schemat bazy → `pnpm db:generate` i migracja jest w PR
- [ ] Zmieniłem/am kształt API lub wyjścia modelu → zaktualizowałem/am `docs/KONTRAKT.md`
- [ ] Nowa zmienna środowiskowa → `.env.example` i `compose.yaml`; nowa zależność → licencja pozwala przekazać kod UKNF
- [ ] Subagent `recenzent` przejrzał diff, zgłoszone błędy poprawione (skill `przed-pr`)
- [ ] Przejrzałem/am diff od AI linijka po linijce (nie tylko "działa")
