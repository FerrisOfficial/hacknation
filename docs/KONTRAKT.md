# InvestWatch: kontrakt API (UI ↔ backend ↔ AI)

**Źródło prawdy** dla REST-a, z którego korzysta dashboard, dla zdarzeń w czasie rzeczywistym i dla wyjścia modelu AI.
Przy sprzeczności z [BACKEND.md](BACKEND.md) wygrywa ten plik. Endpointy, których tu nie ma (`/sources`, `/jobs`, `/materials`, `/reports`, `/stats/summary`, `/collect`), zostają bez zmian.
Ścieżki są względne do `http://localhost:3000/hacknation`. Zmiana kontraktu = PR z akceptacją osoby od UI.

## Kto co dostarcza

- **AI** (`services/ml`): `result`, `confidence`, `quote`, `reason` dla każdej reguły oraz `label`, `probability` i `summary` dla materiału.
- **Backend** (`apps/web/src/app/api`): wszystko pozostałe — pozycje cytatu (`start`, `end`), `timestamp_s`, `link`, dane z katalogu reguł (`rule_name`, `legal_basis`, `kind`), dane z rejestru KNF, `score`, endpointy, progi i alert.
- **UI**: korzysta tylko z punktów 4–10.

## Czego potrzebuje UI

- **Lista incydentów:** `id, module, score, label, summary, firm_name` albo `advertiser`, `platform, url, created_at, status`. Filtry: moduł, zakres dat, platforma, `min_score`, status.
- **Szczegół incydentu:** wszystko z listy, a do tego `material.text` i `published_at`; `entity` (`knf_id, in_register, nip, domain, on_warning_list`); `flags[]` (`rule_id, rule_name, legal_basis, kind, result, confidence, reason`) z `evidence` (`quote, start, end, timestamp_s, link`); `raw_html` z dnia scrapingu (M2 i M3); zmiana statusu `new | in_review | confirmed | dismissed`.
- **Wykres trendu:** liczba incydentów powyżej progu na dzień, z podziałem na moduły.
- **Panel kalibracji:** próg każdego modułu (odczyt i zapis); dla wybranego progu liczba oflagowanych oraz TP, FP, FN, TN, precyzja i pełność, liczone z rekordów `confirmed` i `dismissed`.
- **Alert:** zdarzenie `incident.high_risk` z polami `{ id, module, score, summary, url }`.

Model AI zwraca ocenę reguł, pewność, cytat i uzasadnienie. Backend dokłada resztę i wystawia API dla UI. Wartości w przykładach są zastępcze.

## 1. Model AI: wejście

```json
{
  "material_id": "uuid",
  "module": "risk_disclosure",
  "text": "materials.text",
  "rules": ["1", "3", "10", "14", "15", "17", "18"]
}
```

`module`: `finfluencer` | `risk_disclosure` | `unauthorized_advisory`. W M1 `rules` = `["M1.ad"]`, w M3 `["M3.advisory"]`.

## 2. Model AI: wyjście

```json
{
  "material_id": "uuid",
  "label": "reklama",
  "probability": 0.74,
  "summary": "string",
  "findings": [
    {
      "rule_id": "3",
      "result": "violation",
      "confidence": 0.8,
      "quote": "string | null",
      "reason": "string"
    }
  ],
  "error": null
}
```

- `result`: `violation` | `ok` | `n/a`
- `label`: `reklama` | `wzmianka` (M1), `potencjalne_doradztwo` | `usluga_dozwolona` (M3); w M2 `label` i `probability` = `null`
- `quote`: dosłowny fragment `text`, jeden akapit, do 300 znaków, bez parafrazy; obowiązkowy przy `violation`
- `confidence`, `probability`: od 0 do 1, wartości ciągłe
- model nie zwraca URL-i, pozycji znaków ani sekund filmu
- błąd: `error` z opisem, `findings` puste

## 3. Backend: `analysis_results.details`

```json
{
  "summary": "string",
  "entity": {
    "firm_name": "string | null",
    "knf_id": 0,
    "in_register": true,
    "advertiser": "string | null",
    "nip": "string | null",
    "domain": "string | null",
    "on_warning_list": false
  },
  "flags": [
    {
      "rule_id": "3",
      "rule_name": "string",
      "legal_basis": "string",
      "kind": "hard",
      "result": "violation",
      "confidence": 0.8,
      "reason": "string",
      "evidence": {
        "quote": "string",
        "start": 0,
        "end": 0,
        "timestamp_s": null,
        "link": "string"
      }
    }
  ],
  "error": null
}
```

- `kind`: `hard` | `suggestion`, z katalogu reguł w kodzie, nie z modelu
- `evidence` = `null`, gdy cytatu nie znaleziono w `materials.text`
- `link`: WWW `url + "#:~:text=" + encodeURIComponent(quote).replace(/-/g, "%2D")`, YouTube `url + "&t=" + sekundy + "s"`

## 4. `GET /api/incidents`

Parametry: `module`, `from`, `to`, `platform`, `min_score`, `status`, `page`

```json
{
  "items": [
    {
      "id": "uuid",
      "module": "risk_disclosure",
      "score": 0.8,
      "label": "naruszenie",
      "summary": "string",
      "firm_name": "string | null",
      "advertiser": "string | null",
      "platform": "web",
      "url": "string",
      "created_at": "2026-11-21T20:00:00Z",
      "status": "new"
    }
  ],
  "total": 0
}
```

## 5. `GET /api/incidents/:id`

```json
{
  "id": "uuid",
  "module": "risk_disclosure",
  "score": 0.8,
  "label": "naruszenie",
  "status": "new",
  "created_at": "2026-11-21T20:00:00Z",
  "material": {
    "url": "string",
    "platform": "web",
    "title": "string | null",
    "author": "string | null",
    "text": "string",
    "published_at": "string | null",
    "scraped_at": "string",
    "has_snapshot": true
  },
  "details": "kształt z punktu 3"
}
```

Kopia strony: `GET /api/incidents/:id/snapshot` zwraca `raw_html` jako `text/html`.

## 6. `PATCH /api/incidents/:id`

```json
{ "status": "confirmed" }
```

`status`: `new` | `in_review` | `confirmed` | `dismissed`

## 7. `GET /api/stats/trend`

Parametry: `from`, `to`

```json
{
  "points": [
    { "date": "2026-11-21", "finfluencer": 0, "risk_disclosure": 0, "unauthorized_advisory": 0 }
  ]
}
```

Liczba incydentów ze score ≥ próg modułu.

## 8. `GET` / `PUT /api/settings/threshold`

```json
{
  "finfluencer": { "flag": 0.5, "alert": 0.85 },
  "risk_disclosure": { "flag": 0.5, "alert": 0.85 },
  "unauthorized_advisory": { "flag": 0.5, "alert": 0.85 }
}
```

## 9. `GET /api/calibration?module=&threshold=`

```json
{
  "module": "risk_disclosure",
  "threshold": 0.5,
  "flagged": 0,
  "labeled": 0,
  "tp": 0,
  "fp": 0,
  "fn": 0,
  "tn": 0,
  "precision": 0,
  "recall": 0
}
```

Liczone na rekordach ze statusem `confirmed` (naruszenie) i `dismissed` (brak naruszenia).

## 10. WebSocket: `incident.high_risk`

```json
{ "id": "uuid", "module": "risk_disclosure", "score": 0.91, "summary": "string", "url": "string" }
```

Wysyłany po zapisie wyniku, gdy score ≥ `alert` danego modułu.

## Słowniki

- `module`: `finfluencer` | `risk_disclosure` | `unauthorized_advisory`
- `platform` (enum w `packages/db/src/schema.ts`): `web` | `facebook` | `instagram` | `tiktok` | `youtube` | `x` | `linkedin` | `telegram`
- `status`: `new` | `in_review` | `confirmed` | `dismissed`
- `id` incydentu = id wyniku analizy (`analysis_results`), czyli para (materiał, moduł). Jeden materiał może dać do trzech incydentów.

## Do zrobienia: różnice względem obecnego `main`

Backend z PR #19 i obecny `POST /analyze` mają inny kształt. Do przerobienia:

**AI (`services/ml`)**
- [ ] `POST /analyze` zwraca kształt z punktu 2: `findings[]` per reguła (`result`, `confidence`, `quote`, `reason`) oraz `label`, `probability`, `summary`. Wejście jak w punkcie 1 — jeden moduł i lista reguł na wywołanie.
- [ ] `pnpm api:generate` w tym samym PR.

**Backend (`apps/web`)**
- [ ] Katalog reguł w kodzie: `rule_id` → `rule_name`, `legal_basis`, `kind` (M2: 18 reguł z [materialy-uknf/kryteria-informacji-o-ryzyku.md](materialy-uknf/kryteria-informacji-o-ryzyku.md), M1: `M1.ad`, M3: `M3.advisory`).
- [ ] `analysis_results.details` w kształcie z punktu 3: wyszukanie cytatu w `materials.text` (`start`, `end`; `evidence = null`, gdy nie znaleziono), `timestamp_s` dla filmów, `link`, `entity` z rejestru KNF i listy ostrzeżeń, `score` liczony z wyjścia AI.
- [ ] `GET /api/incidents`: jeden rekord na (materiał, moduł) w kształcie z punktu 4, zamiast grupowania per materiał. Parametry `min_score`, `from`, `to` jak w kontrakcie.
- [ ] `GET /api/incidents/:id` (punkt 5) i `GET /api/incidents/:id/snapshot` (`raw_html` jako `text/html`).
- [ ] `PATCH /api/incidents/:id` ze statusem (punkt 6) zamiast `PATCH /results/:id`.
- [ ] `GET /api/stats/trend?from=&to=` w kształcie z punktu 7.
- [ ] `GET/PUT /api/settings/threshold` z dwoma progami na moduł, `flag` i `alert` (punkt 8). Zmiana schematu `module_settings` = migracja (`pnpm db:generate`).
- [ ] `GET /api/calibration?module=&threshold=` w kształcie z punktu 9.
- [ ] Zdarzenie Socket.io `incident.high_risk` (punkt 10), wysyłane, gdy `score ≥ alert` modułu. Typy w `apps/web/src/lib/realtime/events.ts`.
- [ ] Stare ścieżki (`/thresholds`, `PATCH /results/:id`, zdarzenie `alert`) można usunąć, gdy UI przejdzie na nowe — UI z nich nie korzysta.
- [ ] Aktualizacja [BACKEND.md](BACKEND.md).
