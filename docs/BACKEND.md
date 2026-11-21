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
| `score` | M1/M3: `probability` etykiety pozytywnej (`reklama`, `potencjalne_doradztwo`), dla negatywnej `1 − probability`. M2 (i M1/M3 bez `probability`): noisy-OR pewności naruszeń `1 − Π(1 − w·confidence)`, `w = 1` dla `hard`, `0,5` dla `suggestion`. Błąd modelu: 0 | `lib/analysis/details.ts` |
| `label` | M1/M3: etykieta modelu; M2: `naruszenie` / `brak_naruszen`; błąd modelu: `blad_analizy` | `lib/analysis/details.ts` |
| `model` | opcjonalne pole `model` w odpowiedzi (poza kontraktem), domyślnie `services/ml` | `lib/analysis/details.ts` |

### Moduł 1 bez AI

Moduł ma znaleźć reklamę firmy inwestycyjnej publikowaną przez kogoś innego (docs/ZADANIE.md), a nie oceniać jej treść, więc liczą go reguły w `lib/analysis/finfluencer.ts` (`model = rules/m1`). Wynik ma ten sam kształt §3 co moduły AI, z jedną flagą `M1.ad`.

1. **Firma:** domeny z linków materiału (opis filmu po przekierowaniach, linki wychodzące strony WWW z `POST /scrape`), bez platform i własnej domeny, najwyżej 5 → wyszukiwarka KNF. Pierwsza domena firmy z aktualnym wpisem w rejestrze usług inwestycyjnych, a jeśli żadnej — pierwsza z listy ostrzeżeń KNF. Bez firmy: `brak_firmy`, score 0 (KNF nie odpowiedział: `blad_analizy`).
2. **Podmiot trzeci:** kanał o nazwie firmy (bez form prawnych, np. „XTB” = „XTB S.A.”) albo strona z domen firmy w KNF to jej własny materiał (przypadek dla M2): `material_firmy`, score 0.
3. **Score:** noisy-OR sygnałów `1 − Π(1 − w)`, każdy rodzaj raz: etykieta płatnej promocji YouTube 0,6, kod polecający 0,5, link afiliacyjny (przekierowanie albo `?ref=`/`?aff=`…) 0,5 albo zwykły link 0,3, fraza reklamowa („z moim kodem”, „załóż konto”, „#reklama”…) 0,3. Od 0,5 `reklama` (flaga `violation`), poniżej `wzmianka` (`ok`).
4. **Dowód:** linia tekstu z frazą, kodem albo linkiem (do 300 znaków) — jak w modułach AI, z `timestamp_s`, gdy pada w napisach filmu.

Nie łapie samej wzmianki nazwy firmy bez linku. To miejsce, gdzie AI mogłoby dołożyć sygnał.

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

`REALTIME_PORT`, `REALTIME_HOST`, `REALTIME_CORS_ORIGIN` (Socket.io), `WORKER_ENABLED`, `SCRAPE_CONCURRENCY`, `ANALYZE_CONCURRENCY` (worker), `CONTENT_STORE_DIR` (baza treści), `COLLECTOR_TOKEN` (endpointy dla maszyn).
