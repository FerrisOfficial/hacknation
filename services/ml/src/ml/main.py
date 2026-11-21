from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from pydantic import AnyHttpUrl, BaseModel, Field

from ml.model import Label, predict_sentiment
from ml.scraper import ScrapeError, scrape


def _operation_id(route: APIRoute) -> str:
    return route.name


app = FastAPI(title="ML API", version="0.1.0", generate_unique_id_function=_operation_id)


# Modele pydantic = kontrakt API. Po każdej zmianie: `pnpm api:generate` w roocie repo.
class PredictRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class Prediction(BaseModel):
    label: Label
    score: float = Field(ge=0, le=1)


class ScrapeRequest(BaseModel):
    url: AnyHttpUrl
    include_html: bool = Field(
        default=False, description="Dołącz surowy HTML (np. do zapisu w materials.raw_html)."
    )


class ScrapeResult(BaseModel):
    url: str
    final_url: str = Field(description="Adres po przekierowaniach.")
    status_code: int
    title: str | None
    text: str = Field(description="Tekst bez tagów HTML, znormalizowane białe znaki.")
    content_hash: str = Field(description="SHA-256 znormalizowanego tekstu (deduplikacja).")
    language: str | None
    author: str | None
    description: str | None
    user_agent: str
    fetched_at: datetime
    html: str | None = None


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")


@app.post("/predict")
def predict(request: PredictRequest) -> Prediction:
    label, score = predict_sentiment(request.text)
    return Prediction(label=label, score=score)


@app.post("/scrape", responses={502: {"description": "Strony nie udało się pobrać"}})
def scrape_url(request: ScrapeRequest) -> ScrapeResult:
    try:
        page = scrape(str(request.url))
    except ScrapeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ScrapeResult(
        url=page.url,
        final_url=page.final_url,
        status_code=page.status_code,
        title=page.title,
        text=page.text,
        content_hash=page.content_hash,
        language=page.language,
        author=page.author,
        description=page.description,
        user_agent=page.user_agent,
        fetched_at=page.fetched_at,
        html=page.html if request.include_html else None,
    )
