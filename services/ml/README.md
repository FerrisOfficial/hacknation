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

## Moduł 2: informacja o ryzyku

`POST /analyze` (`module: "risk_disclosure"`) ocenia 13 reguł UKNF, które da się sprawdzić z tekstu, i zwraca dla każdej score oraz dosłowny cytat. Silnik wybiera `M2_ENGINE`:

| `M2_ENGINE` | Jak działa | Czas / strona |
|---|---|---|
| `rules` (domyślnie) | frazy regex → P(naruszenie) reguły | ~0 s |
| `hybrid` (zalecany) | regex wskazuje fragment i decyduje, czy reguła dotyczy; LLM odpowiada TAK/NIE na fragmencie, P(TAK) z logprobs | ~18 s (Bielik 11B, Mac M4) |
| `llm` | LLM ocenia 13 reguł na całym tekście | ~28 s |

Model: `OLLAMA_RISK_MODEL`, domyślnie `hf.co/speakleash/Bielik-PL-11B-v3.0-Instruct-GGUF:Q8_0` (ok. 12 GB, polski tokenizer APT4).

**Mac (16 GB RAM).** Kontener nie widzi GPU Apple, więc Ollamę uruchom natywnie i użyj mniejszej wersji Q4_K_M (ok. 7 GB). SpeakLeash publikuje tylko Q8_0 i FP16, więc Q4_K_M robimy z Q8_0 — tokenizer zostaje w metadanych GGUF:

```bash
brew install ollama llama.cpp
curl -LO https://huggingface.co/speakleash/Bielik-PL-11B-v3.0-Instruct-GGUF/resolve/main/Bielik-PL-11B-v3.0-Instruct.Q8_0.gguf
llama-quantize --allow-requantize Bielik-PL-11B-v3.0-Instruct.Q8_0.gguf bielik-apt4-q4km.gguf Q4_K_M
printf 'FROM ./bielik-apt4-q4km.gguf\nTEMPLATE """{{- range .Messages }}<|im_start|>{{ .Role }}\n{{ .Content }}<|im_end|>\n{{ end }}<|im_start|>assistant\n"""\nPARAMETER stop <|im_end|>\n' > Modelfile
ollama create bielik-pl-11b-apt4:Q4_K_M -f Modelfile
```

W `.env`: `M2_ENGINE=hybrid`, `OLLAMA_RISK_MODEL=bielik-pl-11b-apt4:Q4_K_M`, `OLLAMA_URL=http://host.docker.internal:11434`.

**Reguły wizualne (4, 5, 6, 8, 13)** dla filmów: `risk_visual.py`, OCR (RapidOCR, modele w paczce) + pomiary pikseli, bez LLM. Działają, gdy w `MEDIA_DIR/<material_id>/` są klatki z `manifest.json` — szczegóły i stan w [docs/KLATKI.md](../../docs/KLATKI.md). Pobierania klatek z YouTube jeszcze nie ma.

**Reguła 7 dla filmów:** `risk_video.py` — ostrzeżenie tylko w rozwijanym opisie (wejście `video`).

**Reguły 7 i 8 dla stron WWW:** `risk_web.py` — zapisany HTML renderowany w Chromium przez Playwright (bez JavaScriptu) na komputerze, tablecie i telefonie (wejście `page`). Obraz Dockera instaluje przeglądarkę sam. Lokalnie raz: `uv run playwright install chromium` (testy z przeglądarką bez niej są pomijane, a `/analyze` daje dla tych reguł `n/a`).

Porównanie silników i modeli oraz ewaluacja na etykietach: `scripts/compare_m2.py`, `scripts/compare_models.py`, `scripts/eval_m2.py`.
