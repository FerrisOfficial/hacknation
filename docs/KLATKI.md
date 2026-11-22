# Reguły wizualne M2 z klatek filmu (4, 5, 6, 8, 13) i reguła 7 dla filmów

## Stan

| Część | Stan |
|---|---|
| Ocena reguł 4, 5, 6, 8, 13 z klatek: `services/ml/src/ml/risk_visual.py`, wywoływana w `POST /analyze` | ✅ zaimplementowane, testy na klatkach syntetycznych (`tests/test_risk_visual.py`) |
| Wolumen `media` i `MEDIA_DIR=/data/media` w serwisie `ml` (`compose.yaml`) | ✅ |
| Pobieranie filmów i wycinanie klatek: osobny serwis `services/media` (`POST /videos`: yt-dlp, ffmpeg), opis w [services/media/README.md](../services/media/README.md) | ✅ |
| Reguła 7 dla filmów (ostrzeżenie tylko w rozwijanym opisie): `services/ml/src/ml/risk_video.py`, wejście `video` w `POST /analyze` | ✅ testy w `tests/test_risk_video.py` |
| Backend: kolejka `download-video`, reguły 4, 5, 6, 8, 13 w `rules`, `GET /api/incidents/:id/frames/:file` i `/video` | ✅ |
| Dowód z klatki (`evidence.frame`) i podgląd klatki w UI | ❌ brak |
| Strony WWW: reguły 7 i 8 z renderu zapisanego HTML-a w Chromium (Playwright): `services/ml/src/ml/risk_web.py`, wejście `page` w `POST /analyze` (KONTRAKT.md §1) | ✅ testy w `tests/test_risk_web.py` |
| Strony WWW: reguły 4, 5, 6, 13 z renderu | ❌ osobne zadanie |

Bez modelu językowego i bez modelu wizyjnego. Model z obrazem nie mierzy rozmiaru ani kontrastu, a pomiary pikseli są deterministyczne i szybkie.

## Jak działa ocena

`POST /analyze` z `module: "risk_disclosure"`: gdy istnieje `${MEDIA_DIR}/<material_id>/manifest.json`, a `rules` jest puste albo zawiera którąś z reguł 4, 5, 6, 8, 13, wyniki tych reguł pochodzą z klatek i mają pole `frame` (KONTRAKT.md §2). Bez klatek reguły dostają `n/a`, jak dotąd.

1. **OCR:** RapidOCR z modelami PP-OCRv6, które są w paczce `rapidocr` (bez pobierania w czasie działania, stos działa bez internetu). OCR działa na kopii roboczej klatki (szarość, CLAHE, powiększenie ×2), a ramki są przeliczane na ułamki 0–1 oryginału. Ok. 0,3 s na klatkę na CPU.
2. **Klasyfikacja linii** tymi samymi frazami co w tekście (`risk._FEATURES`): ostrzeżenie o ryzyku (wyraźne frazy, waga ≥ 0,9), wynik historyczny (frazy wyników albo procent przy roku, np. „+142% w 2023”).
3. **Pomiary na oryginale.** Poprawianie kontrastu przed pomiarem ukryłoby naruszenie z reguły 5.

| Reguła | Pomiar | Naruszenie |
|---|---|---|
| 4 | wysokość linii ostrzeżenia / mediana wysokości pozostałych linii, w klatce z najwyższym ostrzeżeniem | < 0,6 |
| 5 | kontrast WCAG tekst–tło w ramce ostrzeżenia (k-means na 2 kolory), w klatce z najlepszym kontrastem | < 4,5:1 (< 3:1 dla tekstu ≥ 5% wysokości kadru) |
| 6 | położenie (górne/dolne 10% kadru) i łączny czas na ekranie wobec czasu czytania (3 słowa na sekundę) | tylko przy krawędzi albo za krótko |
| 8 | wysokość najczytelniejszej linii ostrzeżenia w px CSS po przeskalowaniu filmu do odtwarzacza (widok domyślny, bez pełnego ekranu): telefon 375×812, tablet 768×1024, komputer 854×480; film pionowy wypełnia ekran telefonu | < 9 px na którymś ekranie |
| 13 | ekspozycja = wysokość × kontrast × położenie × (1 + 3 · udział w mapie uwagi). Mapa uwagi: spectral residual, obejmuje też grafiki | wynik historyczny ma najwyższą ekspozycję w klatce |
| 7 | gdzie jest ostrzeżenie: kadr (OCR), transkrypcja, tytuł, pierwsze 150 znaków opisu (widoczne przed „…więcej”) — `risk_video.py`, z wejściem `video` | ostrzeżenie tylko dalej w opisie; bez transkrypcji i klatek `n/a` |

- Brak ostrzeżenia na żadnej klatce: reguły 4, 5, 6, 8 dostają `n/a` (brak ostrzeżenia ocenia reguła 3, z tekstu). Brak wyników historycznych: reguła 13 `n/a`.
- `confidence` rośnie z odległością od progu, w przedziale 0,5–0,95. Progi to stałe na początku `risk_visual.py`.
- `quote`: tekst linii z OCR (do 300 znaków). `reason` podaje liczby, np. „Ostrzeżenie ma 27% wysokości typowego tekstu klatki 0:42 (próg 60%)”.
- `frame`: `{ "ts": 42.0, "file": "42000.png", "box": [x0, y0, x1, y1] }`.

## Klatki na dysku

`${MEDIA_DIR}/<material_id>/manifest.json` + pliki PNG (PNG, nie JPEG: kompresja rozmywa mały tekst i zmienia kolory). M2 czyta `items`. `until` to koniec wyświetlania klatki, potrzebny w regule 6 (bez niego: 1 s).

```json
{
  "status": "done",
  "items": [
    { "ts": 42.0, "until": 47.0, "file": "42000.png" }
  ]
}
```

## Serwis `services/media` (`POST /videos`)

Osobny kontener `media` (FastAPI + yt-dlp + ffmpeg), endpointy w [services/media/README.md](../services/media/README.md). Wejście `{ material_id, url }`, wyjście `manifest.json` z SHA-256 filmu. 502, gdy film się nie pobrał (można ponowić), 422, gdy film jest dłuższy niż `MEDIA_MAX_DURATION_S` albo adres nie jest z YouTube.

- Film to mp4 do 720p (H.264 + AAC) i **zostaje na dysku**, bo Okno sprawy go odtwarza. Klatki: `fps=1`, duplikaty odrzuca filtr `mpdecimate`. Zapis do PNG.
- Wolumen `media` jest podmontowany do `ml` pod `MEDIA_DIR` tylko do odczytu.
- Backend: kolejka `download-video` (`MEDIA_CONCURRENCY`, domyślnie 1). Po pobraniu manifest trafia do `materials.metadata.frames`, a `analyze-material` z `force` dostaje reguły 4, 5, 6, 8, 13. Ręcznie: `POST /api/materials/:id/video`.
- Ręczne wgranie klatek, gdy YouTube blokuje pobieranie (plan B na demo): `docker compose cp <katalog> ml:/data/media/<material_id>`.

## Do zrobienia

- `evidence.ts`: finding z `frame` nie jest szukany w `materials.text`; `evidence.frame = { file, box }`, `timestamp_s = frame.ts`, link `&t=<s>s`.
- Podgląd klatki z zaznaczoną ramką w Oknie sprawy (UI).
- Czarne pasy (`cropdetect`) i gęstsze próbkowanie końcówki filmu (ostrzeżenia często migają na końcu): na razie nie ma.

## Do uzgodnienia

1. **Tekst z OCR w `materials.text`?** Dałby regułę 3 i M3 na tekście z ekranu, ale zmienia `contentHash` po wycięciu klatek. Propozycja: na razie nie.
2. **Progi** (0,6 dla rozmiaru, 4,5:1 dla kontrastu, 3 słowa/s): stroić na prawdziwych klatkach.
