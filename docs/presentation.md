# IVE: prezentacja i film demo

Ustalenia z fazy konceptualizacji (22.11.2026). Oddanie: **22.11.2026, 11:00** — prezentacja PDF obowiązkowo, film do 3 minut opcjonalnie (docs/ZADANIE.md).

## 1. Nazwa i hasło

- **Nazwa:** IVE — Investor Vigilance Engine. #InvestWatch to tylko nazwa zadania UKNF.
- **Wymowa (lektor, scena):** po angielsku „aj-wi-i”.
- **Hasło:** **czuwamy nad inwestorami**.
- **Układ na slajdzie tytułowym:**

  ```
  IVE
  czuwamy nad inwestorami
  Investor Vigilance Engine · odpowiedź na zadanie UKNF #InvestWatch
  ```

## 2. Misja

> **IVE pomaga UKNF znajdować ryzykowne reklamy finansowe dzięki automatycznemu monitoringowi sieci z AI, żeby chronić inwestorów, zanim stracą pieniądze.**

Wersja pełna:

> Pomagamy UKNF wykrywać w internecie i social mediach nielegalne oraz wprowadzające w błąd reklamy inwestycyjne dzięki IVE, czyli jednemu silnikowi scrapingu i trzem modułom AI. Moduły oceniają każdy materiał, wskazują naruszoną regułę i od razu zgłaszają alert. Dzięki temu nadzór reaguje w minutach, a nie tygodniach, ma gotowy dowód (URL, treść, klatkę z filmu) i chroni inwestorów, zanim stracą pieniądze, bez zwiększania liczby etatów.

## 3. Opis marketingowy

> **IVE (Investor Vigilance Engine) to stanowisko pracy nadzoru UKNF nad reklamą finansową w internecie.** System sam przeszukuje strony WWW i YouTube, ogląda filmy klatka po klatce i renderuje strony tak, jak widzi je inwestor na telefonie i komputerze. Trzy moduły AI wykrywają reklamy finfluencerów, ukrywanie ryzyka i doradztwo bez zezwolenia KNF. Analityk dostaje sprawy ułożone według ryzyka. Każda ma dowód (cytat, klatkę z sekundą, kopię strony z dnia pobrania) i podstawę prawną. Decyzja to jeden klawisz, teczka podmiotu to jeden eksport, a każda decyzja kalibruje system. Wszystko działa na serwerach UKNF, bez chmury.

## 4. Kluczowe komunikaty

| Gdzie | Komunikat |
|---|---|
| Tytuł | **IVE: czuwamy nad inwestorami** |
| Wyróżnik | **IVE nie czyta reklam, tylko je ogląda.** |
| Wartość | **Od wykrycia do teczki dowodowej w kilka minut.** |
| Zaufanie | **AI wskazuje i uzasadnia, decyduje człowiek.** |
| Suwerenność | **Wszystko na serwerach UKNF.** Open source, Docker Compose, polski LLM Bielik, zero płatnych API. |

Trzy filary: **znajduje sam, uzasadnia, uczy się na decyzjach.**

## 5. Problem i główna obserwacja

Reklama inwestycyjna przeniosła się do social mediów i wideo. Finfluencer pokazuje zyski, a ostrzeżenie o ryzyku wyświetla na sekundę drobnym drukiem albo chowa je w opisie pod „…więcej”. Konto oferuje „indywidualne strategie inwestycyjne”, choć nie ma zezwolenia KNF. Nadzór przegląda to ręcznie.

> Naruszenie w reklamie wideo nie leży w tekście, tylko w tym, **co widz faktycznie widzi**: jak duże jest ostrzeżenie, jak długo jest na ekranie, czy da się je przeczytać na telefonie. Człowiek musiałby obejrzeć każdy film klatka po klatce. IVE robi to automatycznie.

## 6. Persona: Marta Kowalska, analityczka UKNF

Ta sama osoba, którą aplikacja pokazuje jako użytkownika (`UI_USER_NAME`).

| | Dziś | Z IVE |
|---|---|---|
| Szukanie | ręcznie, frazami, kanał po kanale | harmonogram i kula śnieżna: każde znalezisko wskazuje nowe źródło |
| Ocena | ogląda cały film, rejestr KNF w osobnej karcie | sprawa z dowodem: cytat, klatka z sekundą, rejestr KNF w jednym oknie |
| Dowód | zrzuty ekranu, które łatwo podważyć | kopia z dnia pobrania z SHA-256 i historią decyzji |
| Decyzja | notatka w Excelu | jeden klawisz, potem od razu następna sprawa, z możliwością cofnięcia |
| Sprawa | zebranie materiałów trwa dni | teczka podmiotu w ZIP jednym kliknięciem |
| Jakość | nie wiadomo, ile się przeoczyło | precyzja i pełność liczone z jej własnych decyzji |

## 7. Co robi aplikacja (stan `main`, d4f4e2e)

**Zbieranie**
- Źródła: strony WWW (kopia HTML z dnia pobrania + SHA-256), wyszukiwania i kanały YouTube, strony z linków pod filmami.
- Kolejka pg-boss na Postgresie, harmonogram per źródło, ponowienia z backoffem, bez dublowania zadań. Wyłącznik silnika w Źródłach.
- Kula śnieżna M1: kanał, na którym znaleziono reklamę, staje się nowym źródłem.
- Serwis `media`: pobiera film i wycina klatki; materiał wraca do analizy z regułami wizualnymi.

**Analiza**
- **M1 Reklama (finfluencerzy), bez AI:** materiał po polsku, link albo marka prowadzi do firmy z rejestru KNF / listy ostrzeżeń, autor nie jest tą firmą. Score = noisy-OR wag sygnałów: płatna promocja 0,6, kod polecający 0,5, link afiliacyjny 0,5, link bezpośredni 0,3, fraza reklamowa 0,3, sama marka 0,2.
- **M2 Ryzyko:** 18 reguł UKNF (art. 44 rozp. 2017/565). Tekst: regex + opcjonalnie Bielik (logprobs). Wideo: OCR i pomiary klatek (reguły 4, 5, 6, 8, 13), ostrzeżenie schowane w opisie (7). Strony WWW: render w Chromium na 1280/768/375 px (7, 8).
- **M3 Doradztwo bez zezwolenia:** przesłanki z art. 76 ustawy o obrocie (oferta, rekomendacje, dopasowanie do klienta, odpłatność, uprawnienia, zastrzeżenie) z cytatami, regresja logistyczna, opcjonalnie Bielik (doradztwo / zarządzanie portfelem). Zezwolenie sprawdzane w rejestrze KNF, dane podmiotu (NIP, KRS, e-mail, telefon) do raportu.
- Risk score łączy naruszenia ponad progiem; kilka wysokich naruszeń = wyższy priorytet.
- Silniki: domyślnie `M2_ENGINE=rules`, `M3_ENGINE=rules`; `hybrid` włącza Bielika.

**Praca analityka (ekrany)**
- **Przegląd:** karty modułów (nowe, wysokie ryzyko), statusy z 7 dni, trend 5 min / 1 h / 7 dni / 30 dni.
- **Naruszenia:** pogrupowane po podmiocie, najwyższe ryzyko na górze; zakładki Otwarte / Odłożone / Potwierdzone / Fałszywe alarmy; filtry; klawiatura J/K/Enter.
- **Reklamy:** rejestr M1 „firma, reklamujący, treść, URL” z eksportem CSV. Reklama sama w sobie nie jest naruszeniem.
- **Okno sprawy:** kopia materiału (wideo od oflagowanej sekundy, kopia HTML w piaskownicy, dane), „Dlaczego oflagowano” (reguła, podstawa prawna, wymóg / zalecenie, score, cytat podświetlony albo klatka z ramką, przewiń do momentu), karta podmiotu z KNF, historia z audytem. Decyzja: 1 potwierdź, 2 fałszywy alarm, 3 odłóż z powodem; automatycznie następna sprawa, toast z Cofnij / Ctrl+Z. Otwarcie = „W trakcie”.
- **Widok podmiotu:** oś czasu materiałów, publikujący, rejestr KNF, historia decyzji, **eksport teczki ZIP**.
- **Kalibracja:** suwak progu per moduł; precyzja, pełność i macierz pomyłek z decyzji analityków (od 10 decyzji); lista materiałów, które wypadną przy nowym progu.
- **Źródła:** stan, liczba materiałów, interwał, błędy, „Ponów”, dodawanie źródła.
- **Na żywo:** Socket.io — toast „Wysokie ryzyko” z Otwórz, wyróżniony wiersz, wskaźnik połączenia, odświeżanie w innych przeglądarkach.

## 8. Uzasadnienie modułów (mentorzy: „dlaczego tak” w demo)

### Teza nadrzędna: rejestr KNF rozdziela sprawy

```
                       materiał (WWW / YouTube)
                                 │
                    rejestr KNF + lista ostrzeżeń
              ┌──────────────────┴──────────────────┐
         firma W rejestrze                    podmiot BEZ zezwolenia
     ┌──────────┴──────────┐                        │
 publikuje ktoś inny   publikuje sama firma         M3
        M1                   M2              „czy w ogóle wolno
 „kto reklamuje”       „jak reklamuje”         mu doradzać?”
 (rejestr reklam)      (18 reguł ryzyka)
```

> „Trzy moduły to nie trzy osobne narzędzia. To trzy odpowiedzi na jedno pytanie: **kto mówi i czy ma do tego prawo.** Firmę z licencją rozliczamy z tego, *jak* reklamuje (M2). Podmiot bez licencji z tego, *że* w ogóle oferuje doradztwo (M3). Finfluencera z tego, *czyją* firmę reklamuje (M1).”

Ustalenie z mentorami UKNF (PR #51): M1 i M2 tylko dla firm z rejestru, M3 dla pozostałych. Powiedzieć to wprost.

### M1 bez AI

Teza: M1 nie ocenia treści, tylko ustala fakty. Do faktów nie potrzeba modelu językowego.

1. Specyfikacja M1 to *raport/baza: firma, reklamujący, treść, URL* — dlatego osobny ekran Reklamy, a nie lista naruszeń.
2. Każdy sygnał da się sprawdzić jednym kliknięciem (link do firmy z KNF, „płatna promocja”, kod polecający, link afiliacyjny).
3. Wyjaśnialność: score to suma ważonych sygnałów, wiadomo skąd wynik.
4. Skala: reguły w milisekundach na każdym materiale; LLM tam, gdzie potrzebna interpretacja (M2, M3).
5. Kula śnieżna: M1 karmi silnik scrapingu nowymi kanałami.

> „W M1 celowo nie ma AI. Pytanie »czy ten film linkuje do XTB z kodem polecającym« ma jedną poprawną odpowiedź, którą sprawdzamy w rejestrze KNF. Za to każdy znaleziony kanał staje się nowym źródłem.”

Pokaż: ekran Reklamy + sygnały w Oknie sprawy.

### M2 i M3: jeden silnik, dwa przepisy

| Wspólne | M2 Ryzyko | M3 Doradztwo |
|---|---|---|
| Przepis jako lista reguł | 18 wymogów UKNF (art. 44 rozp. 2017/565) | przesłanki z art. 76 ustawy o obrocie |
| Dosłowny cytat + uzasadnienie dla każdej reguły | ✓ | ✓ |
| Regex jako bramka i źródło cytatów, Bielik jako sędzia (opcjonalnie) | ✓ | ✓ |
| Prawdopodobieństwo z logprobs Bielika, nie „TAK/NIE” | ✓ | ✓ |
| Ten sam scoring, kontrakt i suwak | ✓ | ✓ (#46) |

Dlaczego hybryda regex + LLM, a nie sam LLM:
1. **Bez halucynacji w dowodzie** — cytat z regexa jest dosłowny; LLM tylko ocenia.
2. **LLM tylko tam, gdzie trzeba** — regex odsiewa materiały bez przesłanek, Bielik nie liczy wszystkiego na CPU.
3. **Ciągłe prawdopodobieństwo** — P(TAK) z logprobs daje płynny score, więc suwak realnie przesuwa FP/FN (kryterium jury).
4. **M3 nie reaguje na pojedyncze słowa** — regresja wymaga kombinacji przesłanek.

Wideo i strony bez LLM:

> „Przepis mówi, że ostrzeżenie ma być wyraźne. Wyraźność da się zmierzyć, więc ją mierzymy: wysokość tekstu w pikselach na telefonie, czas na ekranie, czy ostrzeżenie jest schowane pod »…więcej«. To pomiar, a nie opinia modelu.”

Pokaż: Okno sprawy M2 i M3 w tym samym układzie (reguła, cytat, podstawa prawna); dla M2 z wideo klatkę z ramką.

### Pytania jury

| Pytanie | Odpowiedź |
|---|---|
| Czemu nie jeden duży LLM do wszystkiego? | Dowód musi być dosłowny i powtarzalny. LLM ocenia, cytat i pomiar dają reguły. Szybciej na CPU, bez GPU. |
| Działa bez LLM? | Tak, domyślnie `rules`; Bielik (`hybrid`) to opcja przełączana zmienną. |
| Skąd wagi i progi? | Z decyzji analityków: Kalibracja liczy precyzję i pełność z potwierdzeń i fałszywych alarmów. |
| Firma spoza rejestru z ostrzeżeniem o ryzyku? | Nie trafia do M2, bo nie ma licencji. Trafia do M3 — problemem jest brak zezwolenia. |

**Do ustalenia przed demo:** w jakim trybie silnika (`rules` czy `hybrid`). Jeśli mówimy o Bieliku na żywo, sprawdzić czas analizy na CPU.

## 9. Momenty „wow” w demo

| Moment | Co widać | Kryterium jury |
|---|---|---|
| Alert na żywo | nowa fraza w Źródłach → toast „Wysokie ryzyko” | scraping, realtime |
| Klatka z ramką | film od oflagowanej sekundy, ostrzeżenie w ramce „za małe” | trafność, innowacyjność |
| Suwak | lista wypada, precyzja i pełność zmieniają się na żywo | kalibracja |
| Jeden klawisz | 1, 2, 1 — decyzje przelatują, toast z Cofnij | płynność UI |
| Teczka | eksport ZIP podmiotu | gotowość do użycia |
| Proces AI | kontrakt API, hooki, recenzent, CI | 20% punktów |

Przygotowanie danych i stosu: skill `demo` (`.claude/skills/demo/SKILL.md`). Konsola przeglądarki ma być czysta.

## 10. Scenariusz filmu (2:50)

| Czas | Obraz | Lektor |
|---|---|---|
| 0:00–0:12 | Prawdziwy film YouTube z bazy: obietnica zysku, ostrzeżenie przez chwilę na dole kadru, zbliżenie. | „Plus czterdzieści procent w miesiąc. Ostrzeżenie o ryzyku? Było. Przez sekundę, drobnym drukiem.” |
| 0:12–0:22 | Plansza: logo IVE i hasło. | „Aj-wi-i. Czuwamy nad inwestorami. System, który pomaga UKNF znaleźć takie reklamy, zanim inwestorzy stracą pieniądze.” |
| 0:22–0:40 | Przegląd: trzy moduły, trend, „Na żywo”. | „Aj-wi-i sam przeszukuje strony WWW i YouTube według harmonogramu. Każdy materiał trafia do trzech modułów, a analityk widzi tylko to, co wymaga decyzji.” |
| 0:40–1:00 | Diagram: rejestr KNF rozdziela na M1, M2, M3. | „Najpierw pytamy: kto mówi i czy ma do tego prawo? Finfluencer reklamujący licencjonowaną firmę trafia do M1. Firma z licencją, która źle informuje o ryzyku, do M2. Podmiot bez zezwolenia, który doradza, do M3.” |
| 1:00–1:15 | Źródła: nowa fraza, zbieranie, toast „Wysokie ryzyko”. | „Dodajemy frazę. Po chwili alert na żywo.” |
| 1:15–1:45 | Okno sprawy M2: film od sekundy, klatka z ramką, reguła, cytat. | „Aj-wi-i nie czyta reklam, tylko je ogląda. Mierzy, ile pikseli ma ostrzeżenie na telefonie i jak długo jest na ekranie. To pomiar, a nie opinia modelu. Każda flaga ma dowód: klatkę, sekundę, cytat i przepis.” |
| 1:45–1:58 | Klawisz 1: toast z Cofnij, następna sprawa. | „AI wskazuje i uzasadnia, decyduje człowiek. Jeden klawisz i następna sprawa.” |
| 1:58–2:10 | Reklamy (M1): sygnały. | „W M1 celowo nie ma AI. Link do firmy z rejestru i kod polecający to fakty, a nie interpretacja. Każdy znaleziony kanał staje się nowym źródłem.” |
| 2:10–2:20 | Widok podmiotu, eksport teczki ZIP. | „Od wykrycia do teczki dowodowej w kilka minut.” |
| 2:20–2:35 | Kalibracja: suwak, precyzja, pełność, lista. | „Próg ustawia UKNF. System liczy precyzję i pełność z decyzji analityków, więc każdy ruch suwaka od razu pokazuje skutki.” |
| 2:35–2:50 | `docker compose up`, logo, hasło. | „Open source, polski model Bielik, zero chmury. Cały system na serwerach UKNF jedną komendą. Aj-wi-i. Czuwamy nad inwestorami.” |

Nagrywanie: prawdziwe dane, czysta konsola, 1920×1080; najpierw lektor, potem obraz pod niego.

## 11. Szkielet prezentacji PDF (10 slajdów)

1. **IVE: czuwamy nad inwestorami** — Investor Vigilance Engine, odpowiedź na zadanie UKNF #InvestWatch, zespół.
2. **Problem** — klatka z prawdziwej sprawy: obietnica zysku, ostrzeżenie za małe / za krótkie. Reklama w wideo, nadzór ręczny.
3. **Misja** — zdanie z punktu 2.
4. **Kto mówi i czy ma do tego prawo** — diagram rejestru KNF → M1 / M2 / M3, „ustalenie z mentorami”.
5. **M1: fakty zamiast modelu** — dlaczego bez AI, sygnały i wagi, kula śnieżna, rejestr reklam + CSV.
6. **M2 i M3: jeden silnik, dwa przepisy** — tabela wspólnych elementów, hybryda regex + Bielik.
7. **IVE ogląda, nie tylko czyta** — OCR klatek, render na 3 ekranach; klatka z ramką i pomiar w px.
8. **Stanowisko analityka** — Naruszenia, Okno sprawy, Kalibracja, Teczka. „Od wykrycia do teczki dowodowej w kilka minut.”
9. **Architektura i bezpieczeństwo** — web, ml, media, db, ollama; pg-boss, Socket.io, Docker Compose; tylko open source; audyt npm i pip w CI.
10. **Jak budowaliśmy z AI** — kontrakt API jako pierwszy krok, 3 osoby + 3 agenty, 5 warstw egzekwowania zasad (docs/PROCES-AI.md). Zamknięcie: `docker compose up` + hasło.

## 12. Do zrobienia

- [ ] Liczby z lokalnej bazy demo (nie z głowy): źródła, materiały, filmy przeanalizowane klatka po klatce, incydenty per moduł, najczęstsza reguła M2, czas od pobrania do alertu, precyzja i pełność przy zapisanym progu.
- [ ] Prawdziwa sprawa na hook (piksele, sekundy) — wybrać z bazy.
- [ ] Decyzja: tryb silnika w demo (`rules` / `hybrid`).
- [ ] Decyzja: ton (urzędowo-rzeczowy jak gov.pl w UI czy bardziej dynamiczny).
- [ ] Dane demo przez skill `demo` na komputerze, z którego nagrywamy.
- [ ] Nagranie lektora → montaż → film ≤ 3:00.
- [ ] Slajdy → eksport PDF.
