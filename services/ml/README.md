# services/ml

Serwis ML w FastAPI. Zależności zarządza `uv`.

```bash
uv sync                      # instalacja
uv run uvicorn ml.main:app --reload --reload-dir src --port 8000   # albo `pnpm dev` z roota
uv run pytest
uv add torch scikit-learn    # nowe zależności zawsze przez uv add
```

Dokumentacja API po uruchomieniu: http://127.0.0.1:8000/docs

## Kolektory i dane referencyjne

Bezstanowe — zwracają JSON, zapis do bazy robi backend.

| Endpoint | Co robi |
|---|---|
| `POST /scrape` | Jedna strona WWW → tekst, tytuł, hash (httpx + selectolax). |
| `POST /collect/youtube` | Filmy z wyszukiwarki YouTube (domyślnie tylko z etykietą „Zawiera płatną promocję”): metadane, opis, napisy jako tekst, kody promocyjne i strony z linków w opisie. Bez pobierania wideo. |
| `GET /knf/warnings` | Lista ostrzeżeń publicznych KNF: podmioty, KRS/NIP/REGON, domeny. |
| `GET /knf/entities?q=` | Wyszukiwarka podmiotów KNF (nazwa, numer, domena): rejestr i czy to aktualny wpis firmy inwestycyjnej. |

Wszystkie kolektory używają `SCRAPER_PROXY_URL`, jeśli jest ustawiony.
