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
| `GET /incidents` | to samo, zgrupowane per materiał (`maxScore`, `riskLevel`, `flaggedModules`, `results.{module}`) |
| `PATCH /results/:id` | zmiana statusu: `{ status: new \| in_review \| confirmed \| dismissed, note? }` |
| `GET /thresholds` · `PUT /thresholds` | progi modułów. PUT: `{ module, threshold }` (0,01–0,99) |
| `GET /calibration?module=&threshold=` | TP/FP/FN/TN, precision, recall, F1 i liczba alertów dla progu, krzywa co 0,05, `recommendedThreshold` (max F1) |
| `GET /stats/summary` | kafelki: źródła, materiały, wyniki per moduł/ryzyko/status, zadania z 24 h |
| `GET /stats/trend?bucket=hour\|day\|week&scope=flagged\|high\|all` | incydenty w czasie, gotowe pod Recharts: `[{ bucket, finfluencer, risk_disclosure, unauthorized_advisory, total }]` |
| `GET /reports/:module?format=csv\|json` | raport modułu dla UKNF (podmiot, reklamujący, treść, URL, frazy, braki informacji o ryzyku). CSV pod polskiego Excela |
| `GET /realtime` | port Socket.io dla przeglądarki |

Filtry `/results` i `/incidents`: `module`, `status`, `risk` (`low|medium|high`), `platform` (listy po przecinku), `sourceId`, `from`/`to` (data wykrycia), `q`, `minScore`, `sort=date|score`, `page`, `pageSize`.

**Ryzyko** liczymy względem progu modułu: `low` < próg ≤ `medium` < (próg+1)/2 ≤ `high`. Zmiana progu w panelu kalibracji od razu zmienia listy, statystyki i raporty, bez przeliczania wyników.

**Kalibracja**: prawdą bazową są decyzje analityków (`confirmed` = naruszenie, `dismissed` = fałszywy alarm). Bez oznaczonych wyników metryki mają `null`.

Dla maszyn (`Authorization: Bearer $COLLECTOR_TOKEN`):

| Metoda i ścieżka | Co robi |
|---|---|
| `POST /materials` | wgranie materiałów z zewnętrznego kolektora: `{ sourceId?, materials: [{ url, platform, text, title?, author?, html?, publishedAt?, metadata? }] }` |
| `PUT /materials/:id/analysis` | wyniki modułów AI z zewnątrz, w tym samym kształcie co odpowiedź `/analyze` |
| `POST /collect/youtube` | synchroniczny kolektor YouTube (dla skryptów) |

## Kontrakt z serwisem ML: `POST /analyze`

Worker woła `POST {ML_API_URL}/analyze` (`apps/web/src/lib/ml.ts`, schemat w `lib/analysis/contract.ts`). Dopóki endpointu nie ma, analiza kończy się jednym wpisem w logu, bez ponawiania.

```jsonc
// żądanie
{ "material_id": "uuid", "url": "...", "platform": "youtube", "title": "...", "author": "...",
  "text": "...", "language": "pl", "published_at": null, "metadata": { /* np. paid_promotion */ },
  "modules": ["finfluencer", "risk_disclosure", "unauthorized_advisory"] }
// odpowiedź: moduł, który nie dotyczy materiału, może nie zwrócić wyniku
{ "results": [
  { "module": "finfluencer", "score": 0.91, "label": "reklama_firmy_inwestycyjnej", "model": "gemma4:e2b",
    "details": {
      "entity": { "name": "XTB S.A.", "knf_id": 123, "registered": true, "register_name": "..." },
      "advertiser": "...",              // gdy inny niż materials.author
      "phrases": ["kod polecający"],    // M1, M3
      "missing_requirements": ["..."],  // M2
      "explanation": "..."
    } }
] }
```

Gdy endpoint trafi do OpenAPI serwisu ML (`pnpm api:generate`), przepnij `analyzeMaterial` na typowany `ml.POST("/analyze")`.

## Zdarzenia Socket.io

```ts
import { io } from "socket.io-client";
const { port } = await fetch(withBasePath("/api/realtime")).then((r) => r.json());
const socket = io(`${location.protocol}//${location.hostname}:${port}`);
socket.on("alert", (e: AlertEvent) => toast(...));
```

Typy: `apps/web/src/lib/realtime/events.ts`.

| Zdarzenie | Kiedy |
|---|---|
| `alert` | wynik właśnie przekroczył próg modułu (`riskLevel`: `medium` albo `high`). Ponowna analiza już flagowanego materiału nie wysyła go drugi raz |
| `job` | zadanie scrapowania zmieniło status (`queued` → `running` → `done`/`failed`) |
| `result` | analityk zmienił status wyniku |
| `thresholds` | ktoś zmienił próg w panelu kalibracji |

## Zmienne środowiskowe (`apps/web/.env.example`)

`REALTIME_PORT`, `REALTIME_HOST`, `REALTIME_CORS_ORIGIN` (Socket.io), `WORKER_ENABLED`, `SCRAPE_CONCURRENCY`, `ANALYZE_CONCURRENCY` (worker), `CONTENT_STORE_DIR` (baza treści), `COLLECTOR_TOKEN` (endpointy dla maszyn).
