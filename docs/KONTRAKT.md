# InvestWatch: kontrakt API (UI ↔ backend ↔ AI)

**Źródło prawdy** dla REST-a, z którego korzysta dashboard, dla zdarzeń w czasie rzeczywistym i dla wyjścia modelu AI.
Przy sprzeczności z [BACKEND.md](BACKEND.md) wygrywa ten plik. Endpointy, których tu nie ma (`/sources`, `/jobs`, `/materials`, `/reports`, `/stats/summary`, `/collect`), zostają bez zmian.
Ścieżki są względne do `http://localhost:3000/hacknation`. Zmiana kontraktu = PR z akceptacją osoby od UI.

## Kto co dostarcza

- **AI** (`services/ml`): `result`, `confidence`, `quote`, `reason` dla każdej reguły oraz `label`, `probability` i `summary` dla materiału — w modułach 2 i 3. W regułach wizualnych M2 (4, 5, 6, 13, z klatek filmu) także `frame` (klatka i ramka cytatu). **Moduł 1 nie używa AI**: backend liczy go regułami (firma z rejestru KNF w linkach materiału + sygnały reklamy), szczegóły w [BACKEND.md](BACKEND.md#modu%C5%82-1-bez-ai).
- **Backend** (`apps/web/src/app/api`): wszystko pozostałe — pozycje cytatu (`start`, `end`), `timestamp_s`, `link`, dane z katalogu reguł (`rule_name`, `legal_basis`, `kind`), dane z rejestru KNF, `score`, endpointy, progi i alert.
- **UI**: korzysta tylko z punktów 4–10.

## Czego potrzebuje UI

- **Lista incydentów:** `id, module, score, label, summary, firm_name` albo `advertiser`, `platform, url, created_at, status`. Filtry: moduł, zakres dat, platforma, `min_score`, status.
- **Szczegół incydentu:** wszystko z listy, a do tego `material.text` i `published_at`; `entity` (`knf_id, in_register, nip, domain, on_warning_list`); `flags[]` (`rule_id, rule_name, legal_basis, kind, result, confidence, reason`) z `evidence` (`quote, start, end, timestamp_s, link, frame`), a dla dowodu z klatki filmu obraz klatki z zaznaczoną ramką; `raw_html` z dnia scrapingu (M2 i M3); zmiana statusu `new | in_review | confirmed | dismissed`.
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

`module`: `risk_disclosure` | `unauthorized_advisory` (M1 liczy backend bez modelu). W M3 `rules` = `["M3.advisory"]`.

Reguły wizualne M2 (4, 5, 6, 13) dla filmów ocenia ten sam moduł M2 w tym samym `POST /analyze`: backend dodaje je do `rules`, gdy materiał ma wycięte klatki (`materials.metadata.frames.status = "done"`). Klatki serwis ML czyta z dysku po `material_id`, kształt wejścia się nie zmienia. Bez klatek te reguły dostają `n/a`. Stan i plan: [KLATKI.md](KLATKI.md).

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
      "reason": "string",
      "frame": null
    }
  ],
  "error": null
}
```

- `result`: `violation` | `ok` | `n/a`
- `label`: `potencjalne_doradztwo` | `usluga_dozwolona` (M3); w M2 `label` i `probability` = `null`. Etykiety M1 nadaje backend: `reklama` | `wzmianka` | `material_firmy` | `brak_firmy` | `inny_jezyk` | `blad_analizy`
- `quote`: dosłowny fragment `text`, jeden akapit, do 300 znaków, bez parafrazy; obowiązkowy przy `violation`. W regułach wizualnych (4, 5, 6, 13): tekst linii odczytanej przez OCR z klatki `frame`
- `frame`: tylko reguły wizualne M2, gdy cytat pochodzi z klatki filmu: `{ "ts": 42.0, "file": "42000.png", "box": [0.05, 0.94, 0.93, 0.97] }` — sekunda klatki od początku filmu, plik klatki materiału i ramka tekstu `[x0, y0, x1, y1]` jako ułamki 0–1 szerokości i wysokości klatki. W pozostałych przypadkach `null` (brak pola = `null`). Wartości liczy kod OCR, nie model językowy
- `confidence`, `probability`: od 0 do 1, wartości ciągłe
- model nie zwraca URL-i, pozycji znaków ani sekund filmu (wyjątek: `frame` wyżej)
- błąd: `error` z opisem, `findings` puste
- **M2 dodatkowo** (poza polami wyżej): `rule_scores` — `{ "3": { "p_violation": 0.99, "weight": 1.0, "score": 0.99 }, … }`, score każdej reguły = `weight × p_violation` (reguły formalne 1 i 2 mają `weight` 0,3); `risk_score` — jedna liczba 0–1 ze wszystkich reguł, **tylko do sortowania** (noisy-OR z zanikiem). Próg porównujemy ze score'ami reguł, nigdy z `risk_score`

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
      "score": 0.8,
      "reason": "string",
      "evidence": {
        "quote": "string",
        "start": 0,
        "end": 0,
        "timestamp_s": null,
        "link": "string",
        "frame": null
      }
    }
  ],
  "error": null
}
```

- `kind`: `hard` | `suggestion`, z katalogu reguł w kodzie, nie z modelu
- `score`: score reguły z `rule_scores` (M2). Reguła przekracza próg, gdy `score ≥ flag` modułu — karta incydentu pokazuje jako naruszenia tylko takie reguły. `null` w M1, M3 i w wynikach zapisanych wcześniej
- `evidence` = `null`, gdy cytatu nie znaleziono w `materials.text`. Dowód z klatki (`frame` w wyjściu modelu) nie jest szukany w tekście: tekstu z ekranu nie ma w `materials.text`
- `start`, `end`: pozycja cytatu w `materials.text` (`number`); `null`, gdy dowód pochodzi z klatki filmu. Nie podświetlaj `material.text` przy `frame` ≠ `null`
- `frame`: `null` dla cytatu z tekstu. Dla dowodu z klatki `{ "file": "42000.png", "box": [0.05, 0.94, 0.93, 0.97] }` przepisane z wyjścia modelu. Wtedy `timestamp_s` = `frame.ts` z wyjścia modelu, a `link` prowadzi do tej sekundy filmu
- `link`: WWW `url + "#:~:text=" + encodeURIComponent(quote).replace(/-/g, "%2D")`, YouTube `url + "&t=" + sekundy + "s"`

## 4. `GET /api/incidents`

Parametry: `module`, `from`, `to`, `platform`, `min_score`, `status`, `sort` (`risk` — domyślnie, najwyższy `risk_score` pierwszy; `date` — najnowsze pierwsze), `page`

```json
{
  "items": [
    {
      "id": "uuid",
      "module": "risk_disclosure",
      "score": 0.8,
      "risk_score": 0.9,
      "label": "naruszenie",
      "summary": "string",
      "firm_name": "string | null",
      "advertiser": "string | null",
      "platform": "web",
      "url": "string",
      "created_at": "2026-11-21T20:00:00Z",
      "title": "string | null",
      "in_register": true,
      "status": "new",
      "reviewed_by": { "id": "uuid", "name": "Marta Kowalska", "role": "analityczka" },
      "reviewed_at": "2026-11-21T21:00:00Z",
      "review_note": "string | null"
    }
  ],
  "total": 0
}
```

- `title`: `materials.title`; `in_register`: `details.entity.in_register`.
- `reviewed_by` / `reviewed_at`: kto i kiedy ostatnio zmienił status (także automatyczne `in_review` po otwarciu sprawy). `null` przy `status = new`.
- `review_note`: powód decyzji (np. „dowód niepełny” przy `postponed`), inaczej `null`.

## 5. `GET /api/incidents/:id`

```json
{
  "id": "uuid",
  "module": "risk_disclosure",
  "score": 0.8,
  "label": "naruszenie",
  "status": "new",
  "reviewed_by": null,
  "reviewed_at": null,
  "review_note": null,
  "created_at": "2026-11-21T20:00:00Z",
  "material": {
    "url": "string",
    "platform": "web",
    "title": "string | null",
    "author": "string | null",
    "text": "string",
    "published_at": "string | null",
    "scraped_at": "string",
    "has_snapshot": true,
    "duration_s": 312,
    "content_hash": "sha256 hex"
  },
  "details": "kształt z punktu 3",
  "history": [
    { "at": "2026-11-21T21:00:00Z", "actor": { "id": "uuid", "name": "Marta Kowalska", "role": "analityczka" }, "action": "Odłożony: dowód niepełny", "status": "postponed" },
    { "at": "2026-11-21T20:00:00Z", "actor": null, "action": "oflagowano 0,84 przy progu 0,55", "status": null }
  ]
}
```

- `reviewed_by`, `reviewed_at`, `review_note`: jak w §4.
- `material.duration_s`: długość filmu z metadanych YouTube, `null` dla stron WWW.
- `material.content_hash`: SHA-256 zapisanej kopii (R4) — surowego HTML-a z dnia scrapingu, a dla materiałów bez kopii (np. filmów) skrót tekstu `materials.content_hash`.
- `history`: od najnowszego. `actor = null` = system: oflagowanie (`oflagowano 0,84 przy progu 0,55`), alert (`alert: wysokie ryzyko …`), ponowna analiza ze zmianą score'u. Zmiany statusu mają autora i `status`. Wyniki sprzed historii dostają wpis `oflagowano <score>` z datą wykrycia.

Teczka podmiotu (Z7): `GET /api/entities/dossier?firm=<nazwa>` zwraca `application/zip` (`Content-Disposition: attachment`). `firm` = nazwa podmiotu jak w Kolejce (`firm_name`, a bez niej `advertiser`). W środku `spis.txt`, `teczka.json` i katalog na każdy potwierdzony materiał: `material.json` (materiał, wyniki modułów z `details` i historią), `tekst.txt`, `kopia.html` (gdy jest kopia). Bierze wszystkie potwierdzone, także poniżej obecnego progu `flag`. 404, gdy podmiot nie ma potwierdzonych materiałów.

Analityk: `GET /api/me` → `{ "id": "uuid", "name": "string", "role": "string | null" }`. Bez logowania to jeden użytkownik z env (`UI_USER_NAME`, `UI_USER_ROLE`, opcjonalnie `UI_USER_ID`).

Kopia strony: `GET /api/incidents/:id/snapshot` zwraca `raw_html` jako `text/html`.

Klatka filmu (dowód reguł wizualnych): `GET /api/incidents/:id/frames/:file` zwraca obraz jako `image/png`, `:file` = `evidence.frame.file`. 404, gdy materiał nie ma takiej klatki.

## 6. `PATCH /api/incidents/:id`

```json
{ "status": "postponed", "review_note": "dowód niepełny" }
```

`status`: `new` | `in_review` | `postponed` | `confirmed` | `dismissed`. `review_note` opcjonalne (do 500 znaków); bez niego poprzedni powód znika. Zapisuje autora (`/api/me`) i czas, a przy zmianie statusu albo powodu — wpis w `history`. `new` czyści autora i czas.

## 7. `GET /api/stats/trend`

Parametry: `from`, `to`, `bucket` (opcjonalny): `day` (domyślnie), `5min` albo `minute`

```json
{
  "points": [
    { "date": "2026-11-21", "finfluencer": 0, "risk_disclosure": 0, "unauthorized_advisory": 0 }
  ]
}
```

Liczba incydentów ze score ≥ próg modułu w koszyku czasu (Europe/Warsaw). `date` to `YYYY-MM-DD` dla `day`, a dla `5min` i `minute` początek koszyka `YYYY-MM-DDTHH:MM`. Koszyki minutowe zasilają wykres „5 min” i „1 h” na Przeglądzie.

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

Liczone na rekordach ze statusem `confirmed` (naruszenie) i `dismissed` (brak naruszenia). `new`, `in_review` i `postponed` to brak decyzji.

## 10. WebSocket: `incident.high_risk`

```json
{ "id": "uuid", "module": "risk_disclosure", "score": 0.91, "summary": "string", "url": "string" }
```

Wysyłany po zapisie wyniku, gdy score ≥ `alert` danego modułu.

## Słowniki

- `module`: `finfluencer` | `risk_disclosure` | `unauthorized_advisory`
- `platform` (enum w `packages/db/src/schema.ts`): `web` | `facebook` | `instagram` | `tiktok` | `youtube` | `x` | `linkedin` | `telegram`
- `status`: `new` | `in_review` | `postponed` | `confirmed` | `dismissed`
- `id` incydentu = id wyniku analizy (`analysis_results`), czyli para (materiał, moduł). Jeden materiał może dać do trzech incydentów.
- `score`: z nim porównujemy próg. W M2 to najwyższy score reguły, więc wynik jest incydentem, gdy **którakolwiek** reguła ma score ≥ próg `flag`.
- `risk_score`: priorytet do sortowania (M2: z ML; M1, M3 i starsze wyniki: równy `score`). Nie porównujemy go z progiem.

## Do zrobienia: różnice względem obecnego `main`

Backend z PR #19 i obecny `POST /analyze` mają inny kształt. Do przerobienia:

**AI (`services/ml`)**
- [x] `POST /analyze` zwraca kształt z punktu 2: `findings[]` per reguła (`result`, `confidence`, `quote`, `reason`) oraz `label`, `probability`, `summary` — M2 (13 reguł tekstowych, #25), z `rule_scores` i `risk_score`.
- [x] `pnpm api:generate` w tym samym PR.
- [x] Pobranie filmu z YouTube i wycięcie klatek: osobny serwis `services/media` (`POST /videos`, bez OCR), plan w [KLATKI.md](KLATKI.md). Klatki i `manifest.json` na wolumenie `media`, podmontowanym do `ml` pod `MEDIA_DIR` (tylko odczyt).
- [x] M2 w `POST /analyze`: reguły 4, 5, 6, 13 z klatek filmu (OCR + pomiary pikseli, bez LLM), `findings[]` z `frame` (punkty 1–2). Klatki z `${MEDIA_DIR}/<material_id>/`, opis w [KLATKI.md](KLATKI.md).

**Backend (`apps/web`)**
- [x] Katalog reguł w kodzie: `rule_id` → `rule_name`, `legal_basis`, `kind` (M2: 18 reguł z [materialy-uknf/kryteria-informacji-o-ryzyku.md](materialy-uknf/kryteria-informacji-o-ryzyku.md), M1: `M1.ad`, M3: `M3.advisory`).
- [x] `analysis_results.details` w kształcie z punktu 3: wyszukanie cytatu w `materials.text` (`start`, `end`; `evidence = null`, gdy nie znaleziono), `timestamp_s` dla filmów, `link`, `entity` z rejestru KNF i listy ostrzeżeń, `score` liczony z wyjścia AI.
- [x] `GET /api/incidents`: jeden rekord na (materiał, moduł) w kształcie z punktu 4, zamiast grupowania per materiał. Parametry `min_score`, `from`, `to` jak w kontrakcie.
- [x] `GET /api/incidents/:id` (punkt 5) i `GET /api/incidents/:id/snapshot` (`raw_html` jako `text/html`).
- [x] `PATCH /api/incidents/:id` ze statusem (punkt 6) zamiast `PATCH /results/:id`.
- [x] `GET /api/stats/trend?from=&to=` w kształcie z punktu 7.
- [x] `GET/PUT /api/settings/threshold` z dwoma progami na moduł, `flag` i `alert` (punkt 8). Zmiana schematu `module_settings` = migracja (`pnpm db:generate`).
- [x] `GET /api/calibration?module=&threshold=` w kształcie z punktu 9.
- [x] Zdarzenie Socket.io `incident.high_risk` (punkt 10), wysyłane, gdy `score ≥ alert` modułu. Typy w `apps/web/src/lib/realtime/events.ts`.
- [x] Usunięte stare ścieżki: `GET/PUT /thresholds`, `PATCH /results/:id`, zdarzenie `alert`.
- [x] Aktualizacja [BACKEND.md](BACKEND.md).
- [x] Kolejka `download-video` → `POST /videos` serwisu media; po sukcesie manifest w `metadata.frames` i ponowna analiza z regułami 4, 5, 6, 13 w `rules` M2 (punkt 1). Film zamawia analiza (YouTube z incydentem) albo otwarcie sprawy; ręcznie `POST /api/materials/:id/video`.
- [ ] Dowód z klatki: `evidence.frame`, `start`/`end` = `null`, `timestamp_s` = `frame.ts` (punkt 3); typy w `lib/analysis/contract.ts` i `lib/incidents/contract.ts`.
- [x] `GET /api/incidents/:id/frames/:file` (punkt 5).

**UI**
- [ ] Szczegół incydentu: przy `evidence.frame` ≠ `null` obraz klatki z zaznaczoną ramką `box` zamiast podświetlenia w `material.text`.

## Ustalenia implementacyjne (REST, punkty 4–10)

- **Incydent = wynik ze `score ≥ flag` modułu.** `GET /api/incidents` i trend pokazują tylko takie wyniki, więc zmiana progu `flag` od razu zmienia listę. `min_score` zawęża dodatkowo. W M2 `score` = najwyższy score reguły, więc próg działa na regułach: incydent, gdy którakolwiek reguła ≥ próg. Sortowanie: domyślnie po `risk_score` (priorytet przeglądu), `sort=date` — najnowsze pierwsze.
- **Poza kontraktem, opcjonalnie:** `page_size` (domyślnie 25, max 200). `module`, `platform`, `status` przyjmują też listy po przecinku (`?status=new,in_review`).
- **Typy pól:** w `entity` każde pole może być `null`, gdy moduł go nie ustalił. `summary` to zawsze string (pusty, gdy brak). `precision` i `recall` są `null`, gdy nie da się ich policzyć (brak oznaczonych rekordów).
- **`PATCH /api/incidents/:id`** zwraca szczegół incydentu po zmianie (kształt z punktu 5).
- **`PUT /api/settings/threshold`:** można wysłać tylko zmieniane moduły. Wartości 0,01–0,99 (zaokrąglane do setnych), `alert ≥ flag`, inaczej 400. Odpowiedź: wszystkie progi.
- **Trend:** dni kalendarzowe w strefie Europe/Warsaw, dni bez incydentów mają zera, bez `from` — ostatnie 30 dni.
- **Kopia strony:** serwowana z nagłówkiem CSP `sandbox` (bez skryptów, formularzy i połączeń). Style i obrazki ładują się ze strony źródłowej. W UI osadzaj w `<iframe>`.
- **`incident.high_risk`** leci raz, gdy wynik przekroczy `alert` (nowy albo wcześniej poniżej). Ponowna analiza już wysokiego wyniku nie wysyła go drugi raz. Socket.io wysyła tylko pola z punktu 10, bez `type`.
- **Typy TS** odpowiedzi i zdarzeń dla UI: `apps/web/src/lib/incidents/contract.ts` (`IncidentList`, `IncidentDetail`, `Trend`, `Calibration`, `HighRiskIncidentEvent`), progi: `ThresholdSettings` w `apps/web/src/lib/analysis/modules.ts`.
- **Zgodność wstecz:** `details` w starym kształcie (`explanation`, `entity.name`, `entity.registered`, `advertiser`) jest czytany jako `summary`, `firm_name`, `in_register`, `advertiser`. Pipeline zapisuje już kształt z punktu 3 — szczegóły (skąd backend bierze każde pole, wzór na `score`) w [BACKEND.md](BACKEND.md#kontrakt-z-serwisem-ml-post-analyze).

## Zmiany dla UI (mockup hi-fi, PR `feat/ui-mockup`)

Frontend jest już zrobiony według ekranów hi-fi z Figmy; backend dostosowuje się do niego. Typy UI: `apps/web/src/lib/client/contract-ui.ts`. Każde pole niżej jest dla UI opcjonalne: bez niego ekran działa, ale pokazuje mniej.
W tej wersji zbieramy tylko **YouTube i strony WWW**; Instagram, Facebook, TikTok zostają w enumie, ale UI nie pokazuje ich w filtrach.

**Status „Odłożony”**
- [x] `review_status` dostaje wartość `postponed` (migracja). Słownik `status` w tym pliku: `new | in_review | postponed | confirmed | dismissed`.
- [x] `PATCH /api/incidents/:id` przyjmuje `{ "status": "...", "review_note": "string" }` (`review_note` opcjonalne; UI wysyła je przy Odłóż: „dowód niepełny”, „czekam na nowe materiały podmiotu”, „do konsultacji”).
- [x] Kalibracja traktuje `postponed` jak brak decyzji (nie liczy do TP/FP/FN/TN).

**Autor i czas decyzji (R16)**
- [x] `GET /api/me` → `{ "id": "string", "name": "Marta Kowalska", "role": "analityczka" }`. Bez logowania: stały użytkownik z env (np. `UI_USER_NAME`, `UI_USER_ROLE`).
- [x] `PATCH` zapisuje `reviewed_by` (użytkownik z `/api/me`) i `reviewed_at` (kolumny już są w `analysis_results`), także przy automatycznym `in_review` po otwarciu materiału.
- [x] §4 i §5: każdy incydent ma `reviewed_by: { id, name, role } | null`, `reviewed_at: string | null`, `review_note: string | null`.
- [x] §5: `history: [{ "at": "ISO", "actor": { id, name, role } | null, "action": "oflagowano 0,84 przy progu 0,55", "status": "confirmed" | null }]` — zdarzenia materiału od najnowszego: oflagowanie, alert, każda zmiana statusu z autorem. `actor = null` = system.

**Lista incydentów (§4)**
- [x] `title: string | null` (`materials.title`): tytuł wiersza w Kolejce. Bez niego UI składa tytuł z `advertiser` i `summary`.
- [x] `in_register: boolean | null` (z `details.entity`): chip „w rejestrze KNF” w nagłówku grupy.

**Wideo i dowód (§5)**
- [x] `material.has_video: boolean` (`metadata.frames.status = "done"`), `material.duration_s: number | null` (metadane YouTube). Pobrany film YouTube **zostaje na dysku** po wycięciu klatek (zmiana względem [KLATKI.md](KLATKI.md), krok 5), bo Okno sprawy odtwarza go od oflagowanej sekundy.
- [x] `GET /api/incidents/:id/video` → `video/mp4` z obsługą `Range` (przewijanie w `<video>`). 404, gdy filmu nie ma.
- [x] `GET /api/incidents/:id/frames/:file` (§5): klatka z serwisu media.
- [ ] `evidence.frame` (§3): czeka na reguły wizualne w M2 (OCR klatek). UI pokazuje wtedy klatkę z ramką `box` i przewija film do `timestamp_s`.
- [x] `material.content_hash: string | null` (SHA-256 kopii, R4) — wyświetlany przy „kopia …”.

**Teczka podmiotu (Z7)**
- [x] `GET /api/entities/dossier?firm=<firm_name>` → `application/zip` (`Content-Disposition: attachment`): potwierdzone materiały podmiotu z kopią HTML lub filmem, klatkami dowodów, `details` i historią decyzji. Na razie bez filmu i klatek — dojdą razem z warstwą pobierania (KLATKI.md).

**Bez zmian kontraktu, ale ważne dla UI**
- Zmiana progu `flag` od razu zmienia listę incydentów (obecne zachowanie). Ekran Kalibracji tak to opisuje.
- Socket.io: `result` po każdej zmianie statusu, żeby inne przeglądarki odświeżyły Kolejkę.
