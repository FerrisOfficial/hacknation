# Serwis media (pobieranie filmów, klatki). Kontekst budowania: services/media. Używane przez compose.yaml.

FROM python:3.14.10-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app

# ffmpeg: łączenie obrazu z dźwiękiem w mp4 (yt-dlp) i wycinanie klatek.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Najpierw same zależności (z uv.lock): warstwa przebudowuje się tylko po zmianie paczek.
COPY pyproject.toml uv.lock README.md .python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --no-editable

# Katalog na wolumen `media` musi należeć do użytkownika aplikacji, zanim Docker go podmontuje.
RUN useradd --system --no-create-home app && mkdir -p /data/media && chown app /data/media
USER app
ENV PATH="/app/.venv/bin:$PATH" MEDIA_DIR=/data/media
EXPOSE 8100
CMD ["uvicorn", "media.main:app", "--host", "0.0.0.0", "--port", "8100"]
