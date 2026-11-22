# Backend #InvestWatch

> **Uwaga:** kształty endpointów dashboardu, zdarzeń Socket.io i `POST /analyze` wyznacza [KONTRAKT.md](KONTRAKT.md). Tam, gdzie ten plik się z nim nie zgadza, obowiązuje kontrakt — lista zmian do zrobienia jest na jego końcu.

Backend to route handlery Next.js (`apps/web/src/app/api`) plus procesy w tle startowane z `apps/web/src/instrumentation.ts`. Wszystko pod `http://localhost:3000/hacknation/api`.

```
źródło ──(cron / „uruchom”)──▶ kolejka pg-boss ──▶ worker: scraper w serwisie ML ──▶ materials (+ HTML w bazie treści)
                                                                   │ nowa/zmieniona treść
                                                                   ▼
             Socket.io ◀── NOTIFY ── analysis_results ◀── worker: POST /analyze w serwisie ML
```

| Element | Gdzie | Jak |
|---|---|---|
| Kolejka zadań | `lib/queue/boss.ts` | [pg-boss](https://github.com/timgit/pg-boss) na tym samym Postgresie (schemat `pgboss`), bez Redisa. Kolejki `scrape-source`, `analyze-material`, `scheduler-tick` |
| Harmonogram (CronJob) | `lib/pipeline/scheduler.ts` | cron pg-boss co minutę; kolejkuje źródła, którym minęło `interval_minutes` od ostatniego scrapowania |
| Worker | `lib/queue/worker.ts` | w procesie `web`. `WORKER_ENABLED=false` wyłącza go (np. w drugiej replice) |
| Baza metadanych | `packages/db/src/schema.ts` | `sources`, `scrape_jobs`, `materials`, `analysis_results`, `module_settings` |
| Baza treści | `lib/content-store.ts` | surowy HTML w plikach gzip adresowanych SHA-256 (`CONTENT_STORE_DIR`, wolumen `content-store`), w SQL tylko `materials.content_ref` |
| Deduplikacja | `lib/pipeline/materials.ts` | upsert po URL; analiza tylko gdy `content_hash` ≠ `analyzed_hash` |
| Agregator modułów 1–3 | `lib/pipeline/results.ts`, `lib/queries/results.ts` | jeden wynik na (materiał, moduł), `GET /api/incidents` łączy je w jeden obiekt |
| Powiadomienia | `lib/realtime/` | Socket.io na porcie `REALTIME_PORT` (3001), zasilany z Postgres `LISTEN/NOTIFY` |

## Endpointy

Dashboard (bez logowania, tylko localhost):

| Metoda i ścieżka | Co robi |
|---|---|
| `GET /sources` · `POST /sources` | źródła z ostatnim zadaniem i terminem następnego. Body: `{ kind: "web_page", url, platform?, intervalMinutes?, runNow? }` albo `{ kind: "youtube_search", query, limit?, paidOnly?, ... }` |
| `GET/PATCH/DELETE /sources/:id` | PATCH: `{ name?, active?, intervalMinutes? }` (`null` = bez harmonogramu) |
| `POST /sources/:id/run` | „uruchom teraz”: 202 `queued` albo 200 `already_queued` |
| `GET /jobs` · `GET /jobs/:id` | historia scrapowania. Filtry: `sourceId`, `status` |
| `GET /materials` · `GET /materials/:id` | wszystko, co zebrano. Szczegóły zawierają tekst, metadane i wyniki 3 modułów |
| `GET /materials/:id/content` | surowy HTML jako `text/plain` (dowód do sprawy) |
| `POST /materials/:id/analyze` | ponowna analiza AI |
| `GET /results` | wyniki modułów (materiał × moduł) |
| `GET /incidents` · `GET/PATCH /incidents/:id` · `GET /incidents/:id/snapshot` | incydenty dla dashboardu (wynik modułu ≥ próg `flag`), szczegół z dowodami, zmiana statusu, kopia strony — kształty w [KONTRAKT.md](KONTRAKT.md) §4–§6 |
| `GET /me` | analityk z env (`UI_USER_NAME`, `UI_USER_ROLE`, `UI_USER_ID`) — autor decyzji i wpisów w historii (tabele `reviewers`, `incident_events`) |
| `GET /entities/dossier?firm=` | teczka podmiotu: ZIP z potwierdzonymi materiałami (kopia HTML, tekst, `details`, historia) |
| `GET /settings/threshold` · `PUT /settings/threshold` | progi `flag` i `alert` per moduł ([KONTRAKT.md](KONTRAKT.md) §8) |
| `GET /calibration?module=&threshold=` | TP/FP/FN/TN, precyzja, pełność i liczba oflagowanych dla progu ([KONTRAKT.md](KONTRAKT.md) §9) |
| `GET /stats/summary` | kafelki: źródła, materiały, wyniki per moduł/ryzyko/status, zadania z 24 h |
| `GET /stats/trend?from=&to=` | incydenty (≥ próg `flag`) na dzień, per moduł ([KONTRAKT.md](KONTRAKT.md) §7) |
| `GET /reports/:module?format=csv\|json` | raport modułu dla UKNF (podmiot, reklamujący, treść, URL, frazy, braki informacji o ryzyku). CSV pod polskiego Excela |
| `GET /realtime` | port Socket.io dla przeglądarki |

Filtry `/results`: `module`, `status`, `risk` (`low|medium|high`), `platform` (listy po przecinku), `sourceId`, `from`/`to` (data wykrycia), `q`, `minScore`, `sort=date|score`, `page`, `pageSize`.

**Ryzyko** (`risk` w `/results`, `/stats/summary`, raportach) liczymy względem progu `flag` modułu: `low` < próg ≤ `medium` < (próg+1)/2 ≤ `high`. Zmiana progu w panelu kalibracji od razu zmienia listy, statystyki i raporty, bez przeliczania wyników.

**Kalibracja**: prawdą bazową są decyzje analityków (`confirmed` = naruszenie, `dismissed` = fałszywy alarm). Bez oznaczonych wyników metryki mają `null`.

Dla maszyn (`Authorization: Bearer $COLLECTOR_TOKEN`):

| Metoda i ścieżka | Co robi |
|---|---|
| `POST /materials` | wgranie materiałów z zewnętrznego kolektora: `{ sourceId?, materials: [{ url, platform, text, title?, author?, html?, publishedAt?, metadata? }] }` |
| `PUT /materials/:id/analysis` | wyniki modułów AI z zewnątrz: `{ outputs: [{ module, ...wyjście modelu z KONTRAKT.md §2 }] }` (backend buduje `details` i score jak dla kolejki) albo gotowe `{ results: [{ module, score, label, model, details }] }` |
| `POST /collect/youtube` | synchroniczny kolektor YouTube (dla skryptów) |

## Kontrakt z serwisem ML: `POST /analyze`

Kształty wejścia i wyjścia: [KONTRAKT.md](KONTRAKT.md) §1–§3. Worker woła `POST {ML_API_URL}/analyze` raz na moduł 2 i 3 (moduł 1 liczą reguły, niżej). Gdy AI zawiedzie, wynik modułu 1 i tak jest zapisywany, a materiał zostaje do ponownej analizy (`apps/web/src/lib/ml.ts`, schematy Zod w `lib/analysis/contract.ts`). Dopóki endpointu nie ma, analiza kończy się jednym wpisem w logu, bez ponawiania. Gdy endpoint trafi do OpenAPI serwisu ML (`pnpm api:generate`), przepnij `analyzeMaterial` na typowany `ml.POST("/analyze")`.

Co backend dokłada do wyjścia modelu (`lib/pipeline/analyze.ts` → `lib/analysis/details.ts`):

| Pole | Skąd | Plik |
|---|---|---|
| `rules` w wejściu | reguły modułu oceniane z tekstu (M2 bez reguł wizualnych 4–8 i 13) | `lib/analysis/rules.ts` |
| `rule_name`, `legal_basis`, `kind` | katalog reguł; reguły spoza katalogu modułu i duplikaty są odrzucane | `lib/analysis/rules.ts` |
| `evidence.quote`, `start`, `end` | cytat szukany w `materials.text` dosłownie, potem bez różnic w wielkości liter, białych znakach, cudzysłowach i myślnikach; `quote` = dokładny fragment tekstu; `evidence = null`, gdy nie znaleziono | `lib/analysis/evidence.ts` |
| `evidence.timestamp_s` | segment napisów filmu (`metadata.transcript.segments`), w którym zaczyna się cytat; `null` dla cytatu z tytułu albo opisu | `lib/analysis/evidence.ts` |
| `evidence.link` | WWW: Text Fragment `#:~:text=`, YouTube: `&t=<s>s` | `lib/analysis/evidence.ts` |
| `entity` | domena (strona WWW albo pierwszy link z opisu filmu poza platformami) i NIP z treści (z sumą kontrolną) → wyszukiwarka KNF i lista ostrzeżeń przez serwis ML (`/knf/entities`, `/knf/warnings`), cache w pamięci (6 h / 24 h). `in_register = false`, gdy KNF nie zna podmiotu; `null`, gdy nie było czego szukać albo KNF nie odpowiedział. `advertiser` = autor materiału spoza WWW | `lib/analysis/entity.ts`, `lib/pipeline/entity.ts` |
| `score` | Z nim porównujemy próg. M1/M3: `probability` etykiety pozytywnej (`reklama`, `potencjalne_doradztwo`), dla negatywnej `1 − probability`. M2: najwyższy `rule_scores[*].score` z ML (reguły z katalogu modułu), czyli incydent, gdy którakolwiek reguła ≥ próg. Bez `rule_scores` (starsze odpowiedzi): noisy-OR pewności naruszeń `1 − Π(1 − w·confidence)`, `w = 1` dla `hard`, `0,5` dla `suggestion`. Błąd modelu: 0 | `lib/analysis/details.ts` |
| `risk_score` | Do sortowania listy incydentów (`sort=risk`, domyślnie). M2: `risk_score` z ML; bez niego równy `score`. Błąd modelu: 0. Kolumna `analysis_results.risk_score` | `lib/analysis/details.ts` |
| `flags[].score` | Score reguły z `rule_scores` (M2), `null` w M1/M3 | `lib/analysis/details.ts` |
| `label` | M1/M3: etykieta modelu; M2: `naruszenie` / `brak_naruszen`; błąd modelu: `blad_analizy` | `lib/analysis/details.ts` |
| `model` | opcjonalne pole `model` w odpowiedzi (poza kontraktem), domyślnie `services/ml` | `lib/analysis/details.ts` |

### Moduł 1 bez AI

Moduł ma znaleźć reklamę firmy inwestycyjnej publikowaną przez kogoś innego (docs/ZADANIE.md), a nie oceniać jej treść, więc liczą go reguły w `lib/analysis/finfluencer.ts` (`model = rules/m1`). Wynik ma ten sam kształt §3 co moduły AI, z jedną flagą `M1.ad`.

1. **Firma:** domeny z linków materiału (opis filmu po przekierowaniach, linki wychodzące strony WWW z `POST /scrape`), bez platform i własnej domeny, najwyżej 5 → wyszukiwarka KNF. Kandydaci: firmy z aktualnym wpisem w rejestrze usług inwestycyjnych z linków, podmioty z listy ostrzeżeń KNF z linków, marki wymienione w tekście (pkt 6). Reklamowana jest ta z najwyższym score (pkt 3), przy remisie — pierwsza; pozostałe trafiają do podsumowania („Wymienia też: …”). Bez firmy: `brak_firmy`, score 0 (KNF nie odpowiedział: `blad_analizy`). Podsumowanie mówi, jaki to wpis w KNF: dom maklerski, bank z działalnością maklerską, firma zagraniczna z notyfikacją (z oddziałem w Polsce albo bez), zagraniczny bank.
   - **Domena znanej marki** (`domains` w `lib/analysis/brands.ts`): najpierw wpis KNF po marce, potem po domenie. KNF trzyma domenę przy innej spółce z grupy (xtb.com przy XTB Ltd, a polski klient ma umowę z XTB S.A.) albo nie ma jej wcale (biura maklerskie banków, Interactive Brokers). Z kilku wpisów marki wygrywa polski rejestr firm inwestycyjnych (dom maklerski, bank prowadzący działalność maklerską), potem notyfikacja. DEGIRO, Saxo i Trade Republic KNF ma tylko jako zagraniczne instytucje kredytowe — dla tych marek to też firmy inwestycyjne (`foreignCreditInstitution`, zob. załącznik UKNF).
   - **Banki, Revolut i Conotoxia (kantor Cinkciarz)** (`needsInvestmentContext`) liczą się tylko w tekście o inwestowaniu (makler…, giełda, inwest…, ETF, IKE/IKZE, obligacje, CFD). Bez tego link do banku to zwykle konto osobiste: `brak_firmy`.
2. **Podmiot trzeci:** kanał o nazwie firmy (bez form prawnych, np. „XTB” = „XTB S.A.”) albo marki (alias ze słownika, np. „PKO Bank Polski”), strona z domen firmy w KNF albo marki — to jej własny materiał (przypadek dla M2): `material_firmy`, score 0.
3. **Score:** noisy-OR sygnałów `1 − Π(1 − w)`, każdy rodzaj raz: etykieta płatnej promocji YouTube 0,6, kod polecający 0,5 (z kolektora YouTube albo z tekstu: po „promocyjny/polecający/partnerski…”, po dwukropku albo z cyfrą; bez skrótów typu ISIN, ETF, IKE), link afiliacyjny (przekierowanie albo `?ref=`/`?aff=`…) 0,5 albo zwykły link 0,3, fraza reklamowa („z moim kodem”, „link partnerski”, „załóż konto”, „#reklama”…) 0,3. Od 0,5 `reklama` (flaga `violation`), poniżej `wzmianka` (`ok`).
   - **Sygnały przy firmie:** materiał bywa sponsorowany przez kogoś innego (film o wycieku danych z Revoluta z kodem sponsora ZEN), więc kod i fraza liczą się tylko w tym samym bloku opisu (akapit do 600 znaków) co link albo nazwa firmy, a w długim tekście (napisy) — do 250 znaków od nich. Kod z nazwą firmy („MBXTB”) albo w jej linku liczy się zawsze. Linia z własnym linkiem to inna oferta z listy („ZEN PRO (kod KBZEN) → zen.com”) — jej kod i fraza nie należą do firmy z sąsiedniej linii. Etykieta płatnej promocji przy samej wzmiance marki liczy się, gdy marka jest w tytule albo ma przy sobie kod lub frazę. Gdy tekst w ogóle firmy nie wymienia (jest tylko link w metadanych), liczy się wszystko.
4. **Dowód:** zdanie z frazą, kodem albo linkiem (do 300 znaków, od początku zdania z sygnałem, cięte na granicy zdania albo słowa) — jak w modułach AI, z `timestamp_s`, gdy pada w napisach filmu. Pierwszeństwo ma fraza wypowiedziana w filmie przy firmie (link do sekundy), potem fraza z linii z firmą, potem linia z kodem albo linkiem firmy. Cytat z rozdziału w opisie („0:11 XTB - Partner odcinka”) dostaje `timestamp_s` z rozdziału.

5. **Język:** przed wszystkim innym — tylko materiały po polsku (`materials.language`, a bez niego proporcja polskich i angielskich słów). Inne: `inny_jezyk`, score 0.
6. **Wzmianka bez linku:** gdy linki nie prowadzą do firmy, marka wymieniona w tekście (słownik `lib/analysis/brands.ts`, do 3 najczęstszych) i potwierdzona w KNF jako firma z rejestru usług inwestycyjnych. Zamiast sygnału linku: `brand_mention` 0,2 — sama wzmianka z frazą to 0,44 (`wzmianka`), z kodem i frazą 0,72 (`reklama`).

**Skąd biorą się materiały M1** (`lib/m1-sources.ts`, `lib/pipeline/m1-sources.ts`):

- **Frazy z marek:** `POST /api/sources/m1` (token `COLLECTOR_TOKEN`, idempotentne) zakłada źródła „{marka} kod / polecam / jak założyć konto / recenzja” dla marek ze słownika (banki: „{bank} rachunek maklerski”, Revolut: „akcje”, „inwestowanie”) — wszystkie filmy, nie tylko z etykietą płatnej promocji, 10 na frazę, harmonogram co 12 h (pierwsze uruchomienie przy najbliższym ticku).
- **Kula śnieżna:** kanał YouTube, w którym M1 znalazł `reklama`, staje się źródłem `youtube_channel` (15 najnowszych filmów co 24 h, `POST /collect/youtube/channel` w serwisie ML). Istniejącego źródła kanału nie zmienia — analityk może je wyłączyć.
- **Tempo:** harmonogram puszcza `SCHEDULER_BATCH` źródeł na minutę (domyślnie 1, od najdawniej scrapowanych), a kolektor pyta YouTube po kolei, z przerwą `YOUTUBE_DELAY_S` (domyślnie 3 s ± 50%) przed każdym zapytaniem i bez dalszych zapytań po pierwszym HTTP 429. Przy szybszym tempie YouTube odpowiada HTTP 429 — takie zadanie kończy się błędem „YouTube ogranicza zapytania”, a nie pustym wynikiem.
- **Limit:** po `MATERIALS_LIMIT` materiałów w bazie (domyślnie 2000, 0 = bez limitu) harmonogram przestaje kolejkować źródła. Ręczne uruchomienie i API działają dalej.

### Moduł 3: doradztwo bez zezwolenia

Doradztwo inwestycyjne (art. 76 ustawy o obrocie, [materialy-uknf/doradztwo-inwestycyjne.md](materialy-uknf/doradztwo-inwestycyjne.md)) to rekomendacja dotycząca instrumentów finansowych, przygotowana dla konkretnego klienta. Model sprawdza z treści, czy ktoś oferuje taką usługę, a backend sprawdza w rejestrze KNF, czy ma do niej zezwolenie.

1. **Przesłanki** (`services/ml/src/ml/advisory.py`, każda z dosłownym cytatem): `M3.offer` (doradztwo, zarządzanie majątkiem, wealth management, family office, sygnały transakcyjne, mentoring), `M3.recommendation` (kup/sprzedaj/trzymaj instrumenty, portfel modelowy), `M3.personal` (dopasowanie do sytuacji i celów klienta, konsultacja 1:1), `M3.paid` (abonament, success fee, „umów konsultację”), `M3.claims` (licencja, certyfikat, CFA), `M3.disclaimer` („to nie jest doradztwo” przy ofercie indywidualnej). Zastrzeżenia („nie stanowi rekomendacji ani doradztwa”), pytania z FAQ i cytaty przepisów nie są przesłanką. Kredyty, ubezpieczenia i doradztwo podatkowe są wyłączone.
2. **P(doradztwo)** (`M3.advisory`): regresja logistyczna na score'ach przesłanek. Sama oferta albo same rekomendacje dają P < 0,5, a oferta z dopasowaniem do klienta i rekomendacjami daje P > 0,8. Przy `M3_ENGINE=hybrid` trzy główne przesłanki ocenia też LLM (Bielik, P(TAK) z logprobs, średnia z regexem). Model jest pytany tylko wtedy, gdy regex daje P ≥ 0,12. Gdy LLM zawiedzie, wynik liczy sam regex.
3. **Podmiot:** nazwa z formą prawną (sp. z o.o., S.A., Ltd…), NIP/KRS/REGON, e-mail i telefon z treści (`subject` w odpowiedzi ML). Gdy domena i NIP nie wskazały podmiotu w KNF, backend szuka po nazwie (`refineEntityByName`, nazwa bez formy prawnej musi się zgadzać).
4. **Rejestr KNF** (`lib/analysis/advisory.ts`, flaga `M3.license`): przy aktualnym wpisie w rejestrze usług inwestycyjnych usługa jest dozwolona (`usluga_dozwolona`, score = P × 0,2). Podmiot z listy ostrzeżeń publicznych dostaje score = 1 − (1 − P) × 0,4. Podmiot spoza rejestru przy P ≥ 0,3 dostaje naruszenie „brak zezwolenia”, a score = P.
5. **Źródła:** `POST /api/sources/m3` (token `COLLECTOR_TOKEN`) zakłada frazy YouTube (`lib/m3-sources.ts`: sygnały VIP, mentoring, konsultacje 1:1, wealth management, family office) — wszystkie filmy, z linkami z opisu. Przeliczenie M3 dla wszystkich materiałów bez ruszania wyników M1 i M2: `POST /api/materials/reanalyze` z `{ "modules": ["unauthorized_advisory"] }`.

## Zdarzenia Socket.io

```ts
import { io } from "socket.io-client";
const { port } = await fetch(withBasePath("/api/realtime")).then((r) => r.json());
const socket = io(`${location.protocol}//${location.hostname}:${port}`);
socket.on("incident.high_risk", (e: RealtimePayload<"incident.high_risk">) => toast(...));
```

Typy: `apps/web/src/lib/realtime/events.ts`.

| Zdarzenie | Kiedy |
|---|---|
| `incident.high_risk` | wynik właśnie przekroczył próg `alert` modułu: `{ id, module, score, summary, url }` ([KONTRAKT.md](KONTRAKT.md) §10). Ponowna analiza już wysokiego wyniku nie wysyła go drugi raz |
| `job` | zadanie scrapowania zmieniło status (`queued` → `running` → `done`/`failed`) |
| `result` | analityk zmienił status wyniku |
| `thresholds` | ktoś zmienił próg w panelu kalibracji |

## Zmienne środowiskowe (`apps/web/.env.example`)

`REALTIME_PORT`, `REALTIME_HOST`, `REALTIME_CORS_ORIGIN` (Socket.io), `WORKER_ENABLED`, `SCRAPE_CONCURRENCY`, `ANALYZE_CONCURRENCY` (worker), `CONTENT_STORE_DIR` (baza treści), `COLLECTOR_TOKEN` (endpointy dla maszyn), `UI_USER_NAME`, `UI_USER_ROLE`, `UI_USER_ID` (kto pracuje w dashboardzie, bez logowania).
