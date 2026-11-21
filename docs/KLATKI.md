# Reguły wizualne M2 z klatek filmu (4, 5, 6, 13)

**Status: propozycja do akceptacji zespołu.** Zmiany w kontrakcie są w [KONTRAKT.md](KONTRAKT.md) w tym samym PR (§1, §2, §3, §5).

## Zakres

- Moduł 2 (informacja o ryzyku) dla **filmów z YouTube**. Reguły z [kryteriów UKNF](materialy-uknf/kryteria-informacji-o-ryzyku.md):
  - **4** rozmiar czcionki ryzyka,
  - **5** ekspozycja i kontrast,
  - **6** ukrywanie ryzyka,
  - **13** dominacja wyników historycznych.
- Reguły 7 (dostęp jednym kliknięciem) i 8 (responsywność) dotyczą tylko stron WWW (DOM w Playwright). W filmie mają wynik `n/a` i nie są opisane w tym dokumencie.
- Strony WWW: reguły 4–6 liczymy z DOM (`getComputedStyle`: rozmiar czcionki, kolory, widoczność), nie z klatek. Osobne zadanie.
- **Bez trenowania modeli.** RF-DETR odkładamy na później: nie mamy oznaczonych klatek, a samo wykrycie ramki nie rozstrzyga o naruszeniu, bo i tak potrzebny jest OCR do treści i pomiarów.

## Podział na warstwy

| Warstwa | Odpowiada za | Czego **nie** robi |
|---|---|---|
| Scraper (`youtube.py`, bez zmian) | link, metadane, napisy | nie pobiera filmów |
| **Pobieranie filmów** (`media.py`, `POST /media/frames`) | yt-dlp → ffmpeg → klatki PNG na dysku + manifest | nie czyta tekstu, nie ocenia reguł |
| **Moduł M2** (`risk.py`, `risk_llm.py`, nowy `risk_visual.py`) | **tekst i obraz**: reguły tekstowe, a dla filmów z klatkami także OCR, pomiary i Gemma dla reguł 4, 5, 6, 13 | nie pobiera filmów |

OCR i Gemma należą do M2, bo to M2 ocenia informację o ryzyku. Reguły wizualne zwracają ten sam `risk.Finding` co reguły tekstowe, a wywołuje je ten sam `_risk_disclosure` w `POST /analyze`. Warstwa pobierania jest wspólna i w przyszłości może dawać klatki także innym modułom, np. M1 albo M3.

## Przebieg

```
scraper (bez zmian: link, metadane, napisy)
   │
   ▼
analyze-material ── M1 (reguły) ──┐
   │                               │ filtr: film YouTube i (M1 = reklama
   │                               │   albo etykieta płatnej promocji
   │                               │   albo słowa kluczowe w napisach/opisie)
   │                               ▼   i brak metadata.frames
   │                 kolejka extract-frames (pg-boss, 1 naraz, singletonKey = material_id)
   │                               │
   │                               ▼
   │                 POST /media/frames ── warstwa pobierania
   │                   yt-dlp → ffmpeg → usunięcie duplikatów → PNG na wolumenie
   │                   manifest → materials.metadata.frames
   │                               │
   │        ◀──── analyze-material (force) ────┘
   ▼
POST /analyze (M2) ── moduł M2
   rules: reguły tekstowe + 4, 5, 6, 13, gdy metadata.frames.status = "done"
   tekst  → risk.py / risk_llm.py (bez zmian)
   klatki → risk_visual.py: OCR (cache na dysku) → pomiary → Gemma
   │
   ▼
jeden wynik M2 → buildAnalysisResult (bez łączenia wyników po stronie backendu)
```

- **Scraper niczego nie pobiera.** Zbiera hurtowo (10 filmów na frazę, 15 na kanał), więc pobieranie każdego filmu byłoby wolne i groziłoby blokadą YouTube.
- **Klatki powstają raz na film.** Analizę można powtarzać (po zmianie promptu lub progu) bez ponownego pobierania. Klatki zostają też jako dowód, gdy film zniknie z YouTube, podobnie jak `raw_html` dla WWW.
- Ponowne `analyze-material` z `force` powtarza też tekstową część M2 i M3. To świadomy koszt: dotyczy tylko podejrzanych filmów i nie wymaga nowej ścieżki w workerze.

## Warstwa pobierania: `POST /media/frames` (`services/ml/src/ml/media.py`)

Wejście: `{ material_id, url }`. Wyjście: manifest (niżej). 502, gdy filmu nie udało się pobrać. 422, gdy film jest dłuższy niż `MEDIA_MAX_DURATION_S`.

1. **Pobranie:** yt-dlp (jest już w zależnościach) z formatem `bv*[height<=720]`, czyli sam obraz bez dźwięku i nie więcej niż 720p. Używa tego samego proxy i opóźnienia co `youtube.py` (`SCRAPER_PROXY_URL`, `YOUTUBE_DELAY_S`).
2. **Czarne pasy:** `ffmpeg cropdetect` na próbce, potem `crop` przy wycinaniu. Bez tego „dół ekranu” z reguły 6 wskazywałby pas, a nie obraz.
3. **Klatki:** `fps=1` na całym filmie, w ostatnich 15 s `fps=2`, bo ostrzeżenia często migają na końcu. Zapis do PNG, nie JPEG: kompresja rozmywa mały tekst i zmienia kolory, a to psuje reguły 4 i 5.
4. **Duplikaty:** dHash w OpenCV (bez nowej biblioteki). Klatka podobna do poprzedniej (odległość ≤ 4) nie jest zapisywana, tylko przedłuża `until` poprzedniej. Dzięki temu znamy czas wyświetlania, potrzebny w regule 6. Najwyżej 200 unikalnych klatek.
5. **Sprzątanie:** po wyciągnięciu klatek plik filmu jest usuwany.

Pliki: `${MEDIA_DIR}/<material_id>/<ts_ms>.png`. Manifest w `materials.metadata.frames` (`jsonb`, bez migracji):

```json
{
  "status": "done",
  "duration_s": 312.0,
  "width": 1280, "height": 720,
  "crop": [0, 90, 1280, 540],
  "policy": { "fps": 1, "tail_s": 15, "tail_fps": 2, "max_frames": 200 },
  "items": [
    { "ts": 42.0, "until": 47.0, "file": "42000.png" }
  ]
}
```

- `status`: `queued` | `done` | `failed` (z polem `error`). Przy `failed` filmu nie pobieramy ponownie automatycznie.
- Ten sam manifest zapisujemy jako `${MEDIA_DIR}/<material_id>/manifest.json`, bo M2 dostaje tylko `material_id` i czyta klatki z dysku.

## Moduł M2: reguły wizualne (`services/ml/src/ml/risk_visual.py`)

`_risk_disclosure` w `main.py` dostaje `material_id`. Reguły 4, 5, 6 i 13 przekazuje do `risk_visual`, a pozostałe, jak dotąd, do `risk` / `risk_llm`. Bez katalogu klatek reguły wizualne dostają `n/a` z uzasadnieniem „brak klatek filmu”, tak jak dziś w `_NOT_EVALUATED`. Wynik to jeden `RiskAnalysis` z jednym `summary`.

**Zapisane klatki się nie zmieniają.** Pomiary (rozmiar, kontrast, położenie) robimy na oryginale. Poprawianie kontrastu przed pomiarem ukryłoby naruszenie z reguły 5.

1. **OCR:** RapidOCR z modelem PP-OCRv5 Latin (polski jest w zestawie), na **kopii roboczej**: szarość, CLAHE, powiększenie ×2. Ramki przeliczamy na ułamki 0–1 oryginału. Wynik zapisujemy w `${MEDIA_DIR}/<material_id>/ocr.json`, więc powtórna analiza nie powtarza OCR.
2. **Poprawka polskich liter:** model Latin myli je, więc zamieniamy `ž→ż`, `š→ś`, `č→ć` (tych liter nie ma w polszczyźnie).
3. **Klasyfikacja linii** przez te same frazy co w `risk.py` (`_FEATURES`: ostrzeżenie o ryzyku, wyniki historyczne, obietnica zysku). Tekst i obraz oceniamy więc tymi samymi kryteriami. Linie niejednoznaczne rozstrzyga LLM.
4. **Pomiary** (tabela niżej).
5. **Gemma (obraz):** tylko reguła 13 i linie niejednoznaczne. Przez `_Ollama` z `risk_llm.py` z dodanym polem `images` w `/api/chat`. Model wizyjny ustawia osobna zmienna `OLLAMA_VISION_MODEL` (domyślnie `gemma4:e2b`), bo tekstowy model M2 (`OLLAMA_RISK_MODEL`, Bielik) nie przyjmuje obrazów.

| Reguła | Pomiar | Naruszenie (domyślny próg) |
|---|---|---|
| 4 | stosunek wysokości linii ostrzeżenia do mediany wysokości pozostałych linii, w klatce z **najlepiej** pokazanym ostrzeżeniem | stosunek < 0,6 |
| 5 | kontrast WCAG między tekstem a tłem w ramce ostrzeżenia (k-means na 2 kolory na oryginale), w najlepszej klatce | < 4,5:1 (< 3:1 dla dużego tekstu) |
| 6 | położenie (dolne lub górne 10% klatki, róg), udział w powierzchni klatki, łączny czas na ekranie wobec czasu czytania (słowa / 3 na sekundę) | czas < czas czytania albo ostrzeżenie tylko w pasie przy krawędzi |
| 13 | czy linia z wynikiem historycznym jest największym tekstem klatki. Potwierdza Gemma pytaniem „co jest najbardziej wyeksponowane?” | wynik historyczny dominuje w ≥ 1 klatce |

- Brak ostrzeżenia na żadnej klatce: reguły 4, 5 i 6 dostają `n/a` z uzasadnieniem „brak ostrzeżenia o ryzyku na ekranie”. Sam brak ostrzeżenia ocenia reguła 3 (tekst).
- `confidence` rośnie z odległością od progu, w przedziale 0,5–0,95. Progi to stałe w `risk_visual.py`, obok `VIOLATION_MIN` i podobnych z `risk.py`. Stroimy je w panelu kalibracji.
- `quote`: tekst linii z OCR, najwyżej 300 znaków (`QUOTE_MAX`). `reason` podaje liczby, np. „Ostrzeżenie ma 17% wysokości głównego tekstu (próg 60%), kontrast 1,3:1, 0:42–0:47”.
- `Finding` dostaje pole `frame: Frame | None = None` (`ts`, `file`, `box`). `AnalysisFinding` w `main.py` wystawia je zgodnie z [KONTRAKT.md](KONTRAKT.md) §2. Potem `pnpm api:generate`.

## Zmiany w backendzie (apps/web)

- `lib/queue`: kolejka `extract-frames` (1 zadanie naraz) i handler. Ustawia `metadata.frames.status`, woła `POST /media/frames` i po sukcesie kolejkuje `analyze-material` z `force`.
- `lib/pipeline/analyze.ts`: filtr i kolejkowanie po M1. Gdy `frames.status = "done"`, `requestedRuleIds` dla M2 zawiera też 4, 5, 6 i 13. Łączenie wyników nie jest potrzebne, bo M2 zwraca je w jednym wywołaniu.
- `lib/analysis/evidence.ts`: finding z `frame` nie jest szukany w `materials.text`. `evidence.frame = { file, box }`, `start`/`end` = `null`, `timestamp_s = frame.ts`, link YouTube `&t=<s>s` (§3).
- `GET /api/incidents/:id/frames/:file` (§5): route handler przekazujący `GET /media/{material_id}/{file}` z serwisu ML. Przeglądarka nie woła FastAPI bezpośrednio.

## Zależności i Docker

- `uv add rapidocr onnxruntime`. OpenCV przychodzi z RapidOCR, więc dHash, k-means i CLAHE nie potrzebują nowych bibliotek. Sprawdzone: instaluje się i działa na Pythonie 3.14.
- `services/ml/Dockerfile`:
  - `apt-get install -y ffmpeg`,
  - **Deno** w przypiętej wersji. yt-dlp od 2025.11 potrzebuje zewnętrznego środowiska JS do YouTube,
  - **modele RapidOCR pobrane w czasie budowania obrazu.** Domyślnie RapidOCR pobiera je przy pierwszym uruchomieniu, a stos ma działać on-premise bez internetu.
- `compose.yaml` w serwisie `ml`:
  - wolumen `media:/data/media`,
  - zmienne `MEDIA_DIR=/data/media`, `MEDIA_MAX_DURATION_S=${MEDIA_MAX_DURATION_S:-900}` i `OLLAMA_VISION_MODEL=${OLLAMA_VISION_MODEL:-gemma4:e2b}`, dopisane też do `.env.example`.
- Gemma: model `gemma4:e2b` ze stosu przyjmuje obrazy (`ollama show` pokazuje `vision`).

## Co już sprawdziliśmy (21.11)

Syntetyczna klatka 800×450: tytuł „+142% w 2023!” 72 px, ostrzeżenie CFD 11 px w kolorze bliskim tła, na dole ekranu.

| Test | Wynik |
|---|---|
| RapidOCR PP-OCRv5 Latin, oryginał | **nie znalazł** ostrzeżenia: za małe i za słaby kontrast |
| RapidOCR na kopii roboczej (szarość + CLAHE + ×2) | znalazł wszystkie 3 linie, 0,6 s na klatkę (CPU, Mac) |
| Pomiary na oryginale | wysokość 0,033 wobec 0,190 tytułu (reguła 4), kontrast **1,3:1** (reguła 5), położenie y = 0,94 (reguła 6), największy tekst to „+142%” (reguła 13) |
| Gemma 4 e2b na tej klatce, 9 s | trafnie: element dominujący to wynik historyczny, niski kontrast. **Błędnie**: „ostrzeżenie nie jest mniejsze”. Cytat niedosłowny (zgubione słowo) |

Wnioski:
- Model wizyjny **nie mierzy**, więc wszystkie pomiary robi OCR z pikselami. Gemmy używamy do oceny znaczenia (reguła 13, niejednoznaczne linie), a nie do cytatów.
- Model Latin myli polskie litery, stąd poprawka w kroku 2.

## Testy

- `services/ml/tests/test_risk_visual.py`: klatki rysowane w teście przez `cv2.putText` o znanym rozmiarze, kolorze i położeniu. Każda reguła ma przypadek z naruszeniem i bez. Testy nie wymagają sieci ani Ollamy (Gemma jest mockowana).
- `services/ml/tests/test_media.py`: yt-dlp i ffmpeg mockowane, tak jak w `test_youtube.py`.

## Kolejność prac (do oddania 22.11, 11:00)

1. **Ryzyko do sprawdzenia od razu:** czy yt-dlp z Deno pobiera film z kontenera `ml`. Jeśli YouTube blokuje, plan B na demo: 2–3 filmy pobrane wcześniej i wrzucone na wolumen ręcznie.
2. Warstwa pobierania z manifestem i wolumenem, a równolegle w M2 reguły **4, 5 i 6**. To czyste pomiary, bez LLM.
3. Reguła **13** z Gemmą i podgląd klatki w UI.

Podział na 3 osoby:
- **A:** warstwa pobierania (yt-dlp, ffmpeg, Dockerfile, compose),
- **B:** moduł M2 (`risk_visual.py`: OCR, pomiary, Gemma, testy),
- **C:** backend i UI (kolejka, filtr, `rules`, `evidence.ts`, podgląd klatki).

Styk A i B to katalog `${MEDIA_DIR}/<material_id>/` z `manifest.json` i PNG. B może zacząć od razu na klatkach z testów.

## Do uzgodnienia

1. **Tekst z OCR w `materials.text`?** Zyskujemy regułę 3 i moduł M3 na tekście z ekranu. Tracimy stabilny `contentHash`: zmienia się po wyciągnięciu klatek, więc materiał wraca do kolejki, a hash z OCR różni się od hasha z czasu scrapowania. Propozycja: na razie nie dopisywać.
2. **Progi domyślne** (0,6 dla rozmiaru, 4,5:1 dla kontrastu, 3 słowa na sekundę): przyjąć teraz, stroić na zebranych przykładach.
