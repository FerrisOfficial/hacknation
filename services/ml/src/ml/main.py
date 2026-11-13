from typing import Literal

from fastapi import FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field

from ml.model import Label, predict_sentiment


def _operation_id(route: APIRoute) -> str:
    return route.name


app = FastAPI(title="ML API", version="0.1.0", generate_unique_id_function=_operation_id)


# Modele pydantic = kontrakt API. Po każdej zmianie: `pnpm api:generate` w roocie repo.
class PredictRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class Prediction(BaseModel):
    label: Label
    score: float = Field(ge=0, le=1)


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")


@app.post("/predict")
def predict(request: PredictRequest) -> Prediction:
    label, score = predict_sentiment(request.text)
    return Prediction(label=label, score=score)
