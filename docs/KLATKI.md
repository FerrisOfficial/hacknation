# Reguły wizualne M2 z klatek filmu (4, 5, 6, 13)

## Stan

| Część | Stan |
|---|---|
| Ocena reguł 4, 5, 6, 13 z klatek: `services/ml/src/ml/risk_visual.py`, wywoływana w `POST /analyze` | ✅ zaimplementowane, testy na klatkach syntetycznych (`tests/test_risk_visual.py`) |
| Wolumen `media` i `MEDIA_DIR=/data/media` w serwisie `ml` (`compose.yaml`) | ✅ |
| Pobieranie filmów i wycinanie klatek (`POST /media/frames`: yt-dlp, ffmpeg) | ❌ brak — klatki trzeba dziś wgrać ręcznie do wolumenu `media` |
| Backend: kolejka `extract-frames`, reguły 4, 5, 6, 13 w `rules`, dowód z klatki (`evidence.frame`), podgląd klatki w UI | ❌ brak |
| Strony WWW: reguły 4–8 z DOM (Playwright) | ❌ osobne zadanie |

Bez modelu językowego i bez modelu wizyjnego. Model z obrazem nie mierzy rozmiaru ani kontrastu, a pomiary pikseli są deterministyczne i szybkie.

## Jak działa ocena

`POST /analyze` z `module: "risk_disclosure"`: gdy istnieje `${MEDIA_DIR}/<material_id>/manifest.json`, a `rules` jest puste albo zawiera którąś z reguł 4, 5, 6, 13, wyniki tych reguł pochodzą z klatek i mają pole `frame` (KONTRAKT.md §2). Bez klatek reguły dostają `n/a`, jak dotąd.

1. **OCR:** RapidOCR z modelami PP-OCRv6, które są w paczce `rapidocr` (bez pobierania w czasie działania, stos działa bez internetu). OCR działa na kopii roboczej klatki (szarość, CLAHE, powiększenie ×2), a ramki są przeliczane na ułamki 0–1 oryginału. Ok. 0,3 s na klatkę na CPU.
2. **Klasyfikacja linii** tymi samymi frazami co w tekście (`risk._FEATURES`): ostrzeżenie o ryzyku (wyraźne frazy, waga ≥ 0,9), wynik historyczny (frazy wyników albo procent przy roku, np. „+142% w 2023”).
3. **Pomiary na oryginale.** Poprawianie kontrastu przed pomiarem ukryłoby naruszenie z reguły 5.

| Reguła | Pomiar | Naruszenie |
|---|---|---|
| 4 | wysokość linii ostrzeżenia / mediana wysokości pozostałych linii, w klatce z najwyższym ostrzeżeniem | < 0,6 |
| 5 | kontrast WCAG tekst–tło w ramce ostrzeżenia (k-means na 2 kolory), w klatce z najlepszym kontrastem | < 4,5:1 (< 3:1 dla tekstu ≥ 5% wysokości kadru) |
| 6 | położenie (górne/dolne 10% kadru) i łączny czas na ekranie wobec czasu czytania (3 słowa na sekundę) | tylko przy krawędzi albo za krótko |
| 13 | ekspozycja = wysokość × kontrast × położenie × (1 + 3 · udział w mapie uwagi). Mapa uwagi: spectral residual, obejmuje też grafiki | wynik historyczny ma najwyższą ekspozycję w klatce |

- Brak ostrzeżenia na żadnej klatce: reguły 4, 5, 6 dostają `n/a` (brak ostrzeżenia ocenia reguła 3, z tekstu). Brak wyników historycznych: reguła 13 `n/a`.
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

Ręcznie, w Dockerze (do czasu warstwy pobierania): `docker compose cp <katalog> ml:/data/media/<material_id>`.

## Do zrobienia

**Warstwa pobierania, `POST /media/frames` (`services/ml/src/ml/media.py`):** wejście `{ material_id, url }`, wyjście manifest.
1. yt-dlp z `bv*[height<=720]` (sam obraz, ≤ 720p), z tym samym proxy i opóźnieniem co `youtube.py`.
2. `ffmpeg cropdetect`, potem `crop`, żeby czarne pasy nie zaburzały reguły 6.
3. Klatki `fps=1`, w ostatnich 15 s `fps=2` (ostrzeżenia migają na końcu), zapis do PNG.
4. Duplikaty: dHash w OpenCV. Podobna klatka przedłuża `until` poprzedniej. Najwyżej 200 klatek.
5. Usunięcie pliku filmu po wycięciu klatek.

Docker: `ffmpeg` i Deno (yt-dlp od 2025.11 potrzebuje środowiska JS do YouTube) w `services/ml/Dockerfile`. Ryzyko: YouTube może blokować pobieranie z kontenera. Plan B na demo: klatki 2–3 filmów pobrane wcześniej i wgrane ręcznie.

**Backend (`apps/web`):**
- kolejka `extract-frames` dla podejrzanych filmów (M1 = reklama, etykieta płatnej promocji albo słowa kluczowe), po sukcesie `analyze-material` z `force`,
- `requestedRuleIds` dla M2 z regułami 4, 5, 6, 13, gdy manifest ma `status = "done"`,
- `evidence.ts`: finding z `frame` nie jest szukany w `materials.text`; `evidence.frame = { file, box }`, `timestamp_s = frame.ts`, link `&t=<s>s`,
- `GET /api/incidents/:id/frames/:file`: podgląd klatki przez backend (przeglądarka nie woła FastAPI).

## Do uzgodnienia

1. **Tekst z OCR w `materials.text`?** Dałby regułę 3 i M3 na tekście z ekranu, ale zmienia `contentHash` po wycięciu klatek. Propozycja: na razie nie.
2. **Progi** (0,6 dla rozmiaru, 4,5:1 dla kontrastu, 3 słowa/s): stroić na prawdziwych klatkach.
