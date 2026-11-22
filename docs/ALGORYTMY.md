# Algorytmy IVE

Jak powstają oceny M1, M2 i M3. Skrót i uruchomienie: [README](../README.md).

## Skąd biorą się score'y

**Cechy z fraz (M2, M3).** Każda fraza ma wagę 0–1: na ile pewnie oznacza daną cechę (np. „gwarantowany zysk” mocniej niż samo „zysk”). Score cechy w akapicie to waga najmocniejszej pasującej frazy. Zaprzeczenia („bez ryzyka” to nie ostrzeżenie), pytania z FAQ i cytaty przepisów są pomijane.

**M1 — finfluencerzy.** Działa, gdy materiał po polsku linkuje albo wymienia firmę z rejestru KNF, a autor nie jest tą firmą. Szuka sygnałów reklamy przy tej firmie. Każdy sygnał ma wagę w: etykieta płatnej promocji YouTube 0,6, kod polecający 0,5, link afiliacyjny 0,5 (zwykły link 0,3), fraza reklamowa („z moim kodem”, „załóż konto”) 0,3, sama wzmianka marki 0,2.
- `score = 1 − Π(1 − wᵢ)` (noisy-OR): każdy sygnał osobno może świadczyć o reklamie, więc `1 − wᵢ` to szansa, że ten sygnał nie świadczy. Iloczyn to szansa, że nie świadczy żaden, a 1 minus iloczyn to szansa, że świadczy przynajmniej jeden. Każdy kolejny sygnał podnosi score, ale nigdy ponad 1.
- Przykład: kod polecający i fraza reklamowa dają 1 − 0,5 · 0,7 = 0,65. Od 0,5 materiał dostaje etykietę `reklama`.
- M1 działa bez LLM, bo ma wykryć reklamę, a nie oceniać jej treść. Kanał, w którym znaleziono reklamę, jest potem obserwowany na stałe.

**M2 — informacja o ryzyku.** Działa dla materiałów firm z rejestru KNF: 18 reguł UKNF z art. 44 rozp. 2017/565. Każda reguła to wzór na score'ach cech, który daje P(naruszenie).
- Reguła 14 (wyniki historyczne bez zastrzeżenia): `P = wyniki · (1 − zastrzeżenie)`. P jest wysokie, gdy w materiale są wyniki historyczne, a nie ma zastrzeżenia, że nie gwarantują przyszłych.
- Reguła 3 (ostrzeżenie ma towarzyszyć obietnicy zysku): ostrzeżenie w tym samym akapicie liczy się ×1, w sąsiednim ×0,85, dwa akapity dalej ×0,5, jeszcze dalej ×0,15. Ostrzeżenie tylko w stopce nie „towarzyszy” obietnicy z nagłówka.
- Reguły 4, 5, 6, 8 i 13 liczy OCR z klatek filmu. Naruszenie jest, gdy: czcionka ostrzeżenia ma mniej niż 0,6 wysokości pozostałego tekstu, kontrast jest poniżej 4,5:1 (WCAG), ostrzeżenie jest na ekranie krócej, niż trwa jego przeczytanie (3 słowa/s), na telefonie ma mniej niż 9 px albo wyniki historyczne są eksponowane mocniej niż ostrzeżenie.
- `score reguły = waga × P(naruszenie)`. Waga to 1, a dla reguł formalnych 1 i 2 (nazwa firmy, oznaczenie reklamy) 0,3, żeby same nie przekraczały progu 0,5. Score materiału to najwyższy score reguły, więc incydent powstaje, gdy którakolwiek reguła przekroczy próg.

**M3 — doradztwo bez zezwolenia.** Działa dla każdego materiału. Według art. 76 u.o.o.i.f. doradztwo to oferowana jako usługa rekomendacja instrumentów finansowych dla konkretnego klienta. Z fraz liczone są trzy przesłanki: oferta usługi (O), rekomendacje instrumentów (R) i dopasowanie do klienta (D).
- `P(doradztwo) = min(O, max(R, D))` zapisuje warunek „oferta I (rekomendacje LUB dopasowanie)”. „I” to minimum: wynik jest tak pewny, jak najsłabszy z warunków koniecznych. „LUB” to maksimum: wystarczy najmocniejsza z przesłanek. Wzór nie ma wag, więc analityk widzi, która przesłanka zdecydowała.
- Przykład: O = 0,85, R = 0,6, D = 0, więc P = min(0,85; 0,6) = 0,6. Finfluencer, który pisze „kupuję akcje X”, nie ma oferty, więc P = 0.
- Odpłatność, powoływanie się na licencje i zastrzeżenie „to nie jest doradztwo” przy ofercie indywidualnej to osobne flagi z cytatem. Nie zmieniają P, ale podnoszą risk score.
- Potem rejestr KNF rozstrzyga, czy to naruszenie. Współczynniki 0,2 i 0,4 są ustalone ręcznie:
  - podmiot z zezwoleniem: `score = P × 0,2`, bo usługa jest legalna i materiał spada na koniec kolejki,
  - podmiot z listy ostrzeżeń KNF: `score = 1 − (1 − P) × 0,4`, czyli brakująca do 1 część score'u maleje o 60%. Przykład: P = 0,5 daje 0,8,
  - podmiot bez wpisu: `score = P`, a przy P ≥ 0,3 dochodzi flaga „brak zezwolenia”.

## Jak Bielik daje prawdopodobieństwo (tryb `hybrid`)

1. Regex wskazuje, czy reguła dotyczy materiału i w którym miejscu (cytat). Bielik-PL-11B dostaje fragment wokół cytatu (± 2 akapity) i pytanie o jedną regułę, z odpowiedzią jednym słowem TAK albo NIE.
2. Nie czytamy wygenerowanego słowa, tylko rozkład prawdopodobieństwa pierwszego tokenu (logprobs). Sumujemy prawdopodobieństwa tokenów zaczynających się na T i na N, a potem `P(TAK) = P(T) / (P(T) + P(N))`.
3. Kalibracja: surowe P jest prawie zawsze bliskie 0 albo 1, więc suwak progu niewiele by zmieniał. Dlatego `P' = σ(logit(P) / T)`, gdzie `logit(P) = ln(P / (1 − P))`, `σ(x) = 1 / (1 + e⁻ˣ)` i T = 2. Wzór rozciąga skalę (0,99 → 0,91), ale nie zmienia kolejności ani decyzji przy 0,5. T = 2 wyszło z dopasowania Platta na etykietach (`scripts/eval_m2.py`).
4. W M2 tak oceniana jest każda reguła tekstowa poza 9, 10, 17 i 18. W tych czterech LLM dawał w ewaluacji same fałszywe alarmy, więc zostaje regex. W M3 model jest pytany tylko wtedy, gdy O ≥ 0,3. Dostaje dwa pytania (doradztwo i zarządzanie portfelem), a P to wyższa z dwóch odpowiedzi.
5. Gdy model nie odpowie, wynik liczą same reguły.

## Risk score

Score decyduje, czy materiał jest incydentem. Risk score ustala kolejność w kolejce i jest pokazywany analitykowi. Liczy się go ze score'ów reguł powyżej progu, ustawionych od najwyższego (s1 ≥ s2 ≥ …):

`risk = 1 − (1 − s1) · (1 − s2/2) · (1 − s3/4) · …`

To noisy-OR, w którym każde kolejne naruszenie waży o połowę mniej. Najpoważniejsze naruszenie liczy się w pełni, więc risk nigdy nie spada poniżej niego. Kolejne podnoszą go coraz słabiej, bo reguły nie są niezależne (12a, 12b i 14 dotyczą tych samych wyników historycznych). Przykład: naruszenia 0,8 i 0,6 dają 1 − 0,2 · 0,7 = 0,86. M1 nie ma score'ów reguł, więc jego risk score to po prostu score. Szczegóły: [docs/BACKEND.md](BACKEND.md).
