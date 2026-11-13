from fastapi.testclient import TestClient

from ml.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_predict_returns_label_and_score() -> None:
    response = client.post("/predict", json={"text": "Ten stack jest świetny"})
    assert response.status_code == 200
    body = response.json()
    assert body["label"] == "positive"
    assert 0 <= body["score"] <= 1


def test_predict_rejects_empty_text() -> None:
    response = client.post("/predict", json={"text": ""})
    assert response.status_code == 422
