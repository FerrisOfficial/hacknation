# Serwis ML (FastAPI). Kontekst budowania: services/ml. Używane przez compose.yaml.

FROM python:3.14.10-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# Najpierw same zależności (z uv.lock): warstwa przebudowuje się tylko po zmianie paczek.
COPY pyproject.toml uv.lock README.md .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

# Chromium (headless shell) dla reguł 7 i 8 M2 na stronach WWW: renderowanie zapisanego HTML-a
# w trzech rozdzielczościach (risk_web.py). Wersja przeglądarki = wersja paczki playwright z uv.lock.
# libatomic1: potrzebny sterownikowi Playwrighta (Node w paczce), slim go nie ma.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && /app/.venv/bin/playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home app
USER app
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "ml.main:app", "--host", "0.0.0.0", "--port", "8000"]
