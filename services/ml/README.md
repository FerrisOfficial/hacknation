# services/ml

Serwis ML w FastAPI. Zależności zarządza `uv`.

```bash
uv sync                      # instalacja
uv run uvicorn ml.main:app --reload --reload-dir src --port 8000   # albo `pnpm dev` z roota
uv run pytest
uv add torch scikit-learn    # nowe zależności zawsze przez uv add
```

Dokumentacja API po uruchomieniu: http://127.0.0.1:8000/docs
