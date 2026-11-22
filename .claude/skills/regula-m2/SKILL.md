---
name: regula-m2
description: Dodanie lub poprawa reguły Modułu 2 (informacja o ryzyku, 18 reguł UKNF z art. 44 rozporządzenia 2017/565) — frazy regex, wzór reguły, testy, ewaluacja na etykietach. Użyj przy fałszywych alarmach lub pominięciach M2.
---

# Reguła Modułu 2

Źródło wymagań: `docs/materialy-uknf/kryteria-informacji-o-ryzyku.md` (id reguły, opis operacyjny, podstawa prawna).
Wynik każdej reguły to `violation | ok | n/a` + score + **dosłowny cytat** (`docs/KONTRAKT.md` §2). Bez cytatu analityk nie ma dowodu.

## Gdzie co jest

| Plik | Rola |
|---|---|
| `services/ml/src/ml/risk.py` | reguły tekstowe: `_FEATURES` (frazy → cecha akapitu), `_EXCLUDE`, `_evaluate` (wzór reguły), `RULE_WEIGHTS` |
| `services/ml/src/ml/risk_llm.py` | wariant `hybrid`/`llm`: Bielik odpowiada TAK/NIE, P(TAK) z logprobs |
| `services/ml/src/ml/risk_visual.py` | reguły 4, 5, 6, 8, 13 z klatek filmu (OCR + piksele) |
| `services/ml/src/ml/risk_web.py` | reguły 7 i 8 dla stron WWW (Playwright, 3 rozdzielczości) |
| `services/ml/src/ml/risk_video.py` | reguła 7 dla filmów (ostrzeżenie tylko w rozwijanym opisie) |
| `services/ml/scripts/eval_m2.py` | precyzja/czułość na etykietach |

## Kroki

1. **Przypadek testowy najpierw.** Dopisz do `services/ml/tests/test_risk.py` zdanie, które powinno (albo nie powinno) dać naruszenia. Użyj prawdziwego cytatu z materiału z bazy, nie wymyślonego.
2. Uruchom i zobacz, że test pada: `cd services/ml && uv run pytest tests/test_risk.py -q`.
3. Popraw frazę w `_FEATURES` / wyjątek w `_EXCLUDE` / wzór w `_evaluate`. Wagi fraz 0–1: 1.0 = jednoznaczne, 0.5–0.7 = sugestia.
4. Testy zielone, potem **ewaluacja** — poprawka jednego fałszywego alarmu nie może zepsuć innych:
   ```bash
   cd services/ml && uv run python scripts/eval_m2.py labels.json raport.md PRZED=<katalog> PO=<katalog>
   ```
   Format `labels.json` i katalogów opisuje docstring skryptu; wyniki wariantów zbiera `scripts/compare_m2.py`. W opisie PR podaj precyzję, pełność i F1 przed i po.
5. Zmiana wag lub progów domyślnych → opisz uzasadnienie w komentarzu przy `RULE_WEIGHTS` (hierarchię wag potwierdzamy z UKNF).
6. Zmiana kształtu `findings` → skill `zmiana-api-ml`.
7. Na działającym stosie przelicz zebrane materiały: `POST /api/materials/reanalyze` (token `COLLECTOR_TOKEN`) i sprawdź wynik w Kolejce i w Kalibracji.

## Zasady

- Reguły dla polskiego tekstu: `_W` obejmuje polskie litery, `re.IGNORECASE | re.UNICODE`.
- Reguła, której nie da się ocenić z danego wejścia, zwraca `n/a` z powodem — nigdy cichego `ok`.
- M2 dotyczy materiałów **samych firm inwestycyjnych** z rejestru KNF. Reklamy osób trzecich to M1.
