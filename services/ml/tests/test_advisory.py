# ruff: noqa: E501 — próbki ofert w jednej linii, z typografią jak w prawdziwych tekstach
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from ml.advisory import (
    ADVISORY_RULE,
    NEGATIVE_LABEL,
    POSITIVE_LABEL,
    analyze_advisory,
    analyze_advisory_engine,
    extract_subject,
    probability,
    rule_scores,
)
from ml.main import app

client = TestClient(app)

WEALTH = """Kowalski Wealth Partners sp. z o.o.
Zarządzamy majątkiem naszych klientów od 15 lat.
Przygotujemy indywidualną strategię inwestycyjną dopasowaną do Twoich celów i sytuacji finansowej.
Wskażemy, które akcje i obligacje kupić, a kiedy sprzedać.
Umów bezpłatną konsultację 1:1. Opłata za zarządzanie: success fee 20% od zysku.
Treści na stronie nie stanowią rekomendacji inwestycyjnej.
NIP: 5252344078, kontakt@kowalski-wealth.pl, +48 600 123 456"""

SIGNALS = """Dołącz do grupy VIP na Telegramie! Codziennie sygnały transakcyjne na forex i złoto.
Kupuj kontrakty na złoto przy 2300, stop loss 2280 take profit 2350. Abonament premium 199 zł/mies."""

FINFLUENCER = """Dziś opowiem o moim portfelu. Kupiłem akcje PKN Orlen i ETF na S&P 500.
Pamiętajcie, to nie jest rekomendacja. Link do XTB w opisie, kod polecający."""

DISCLAIMER_ONLY = """Treści publikowane na tym kanale mają wyłącznie charakter edukacyjny i informacyjny.
Materiały te nie stanowią rekomendacji ani porady inwestycyjnej w rozumieniu art. 76 ustawy.
Nie posiadam uprawnień doradcy inwestycyjnego. Spółka nie oferuje usług doradztwa inwestycyjnego."""

MORTGAGE = "Doradca finansowy pomoże Ci dobrać kredyt hipoteczny dopasowany do Twojej sytuacji. Umów bezpłatną konsultację."


def violations(text: str) -> set[str]:
    return {f.rule_id for f in analyze_advisory(text).findings if f.result == "violation"}


def test_wealth_manager_offer_is_advisory_with_quotes() -> None:
    analysis = analyze_advisory(WEALTH)
    assert analysis.probability == 0.85
    assert analysis.label == POSITIVE_LABEL
    assert violations(WEALTH) >= {
        ADVISORY_RULE,
        "M3.offer",
        "M3.recommendation",
        "M3.personal",
        "M3.paid",
        "M3.disclaimer",
    }
    for finding in analysis.findings:
        if finding.result == "violation":
            assert finding.quote is not None
            assert finding.quote in WEALTH


def test_signal_group_is_advisory() -> None:
    assert analyze_advisory(SIGNALS).probability >= 0.5


@pytest.mark.parametrize("text", [FINFLUENCER, DISCLAIMER_ONLY, MORTGAGE])
def test_no_advisory_without_offer(text: str) -> None:
    analysis = analyze_advisory(text)
    assert analysis.probability < 0.2
    assert analysis.label == NEGATIVE_LABEL


def test_disclaimer_does_not_create_signals() -> None:
    analysis = analyze_advisory(DISCLAIMER_ONLY)
    assert analysis.signals["offer"] == 0
    assert analysis.signals["recommendation"] == 0
    # Zastrzeżenie bez oferty indywidualnej nie jest przesłanką.
    assert analysis.signals["disclaimer"] == 0


def test_question_is_weaker_than_statement() -> None:
    statement = analyze_advisory("Zarządzamy Twoim majątkiem.").signals["offer"]
    question = analyze_advisory("Czy zarządzamy Twoim majątkiem?").signals["offer"]
    assert question < statement


def test_professional_title_is_a_claim_not_an_offer() -> None:
    signals = analyze_advisory(
        "Autor: Jan Nowak, licencjonowany doradca inwestycyjny nr 740."
    ).signals
    assert signals["offer"] == 0
    assert signals["claims"] > 0


def test_extract_subject() -> None:
    subject = extract_subject(WEALTH)
    assert subject.name == "Kowalski Wealth Partners sp. z o.o."
    assert [(i.kind, i.value) for i in subject.identifiers] == [("NIP", "5252344078")]
    assert subject.emails == ("kontakt@kowalski-wealth.pl",)
    assert subject.phones == ("+48 600 123 456",)


def test_requested_rules_only() -> None:
    findings = analyze_advisory(WEALTH, [ADVISORY_RULE]).findings
    assert [f.rule_id for f in findings] == [ADVISORY_RULE]


def _logprobs(answer: str) -> dict[str, object]:
    other = "NIE" if answer == "TAK" else "TAK"
    return {
        "message": {"content": answer},
        "logprobs": [
            {
                "top_logprobs": [
                    {"token": answer, "logprob": -0.05},
                    {"token": other, "logprob": -3.0},
                ]
            }
        ],
    }


@respx.mock
def test_hybrid_engine_uses_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("M3_ENGINE", "hybrid")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama.test")
    route = respx.post("http://ollama.test/api/chat").mock(
        return_value=httpx.Response(200, json=_logprobs("NIE"))
    )
    analysis = analyze_advisory_engine(WEALTH)
    # Dwa pytania: doradztwo inwestycyjne i zarządzanie portfelem.
    assert route.call_count == 2
    sent = json.loads(route.calls[0].request.content)
    assert "art. 76" in sent["messages"][1]["content"]
    assert analysis.engine == "hybrid"
    # Werdykt wydaje LLM: NIE na obie usługi → brak doradztwa mimo przesłanek regex.
    assert analysis.probability < 0.5
    assert analysis.label == NEGATIVE_LABEL
    assert analysis.service is None
    assert set(analysis.llm) == {"advisory", "portfolio"}


@respx.mock
def test_hybrid_llm_verdict_names_service(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("M3_ENGINE", "hybrid")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama.test")
    respx.post("http://ollama.test/api/chat").mock(
        side_effect=[
            httpx.Response(200, json=_logprobs("NIE")),  # doradztwo
            httpx.Response(200, json=_logprobs("TAK")),  # zarządzanie portfelem
        ]
    )
    analysis = analyze_advisory_engine(WEALTH)
    assert analysis.label == POSITIVE_LABEL
    assert analysis.service == "portfolio"
    assert analysis.probability == analysis.llm["portfolio"]
    verdict = next(f for f in analysis.findings if f.rule_id == ADVISORY_RULE)
    assert verdict.result == "violation"
    assert verdict.quote is not None and verdict.quote in WEALTH
    assert "zarządzanie portfelem" in verdict.reason


@respx.mock
def test_hybrid_falls_back_to_rules_when_llm_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("M3_ENGINE", "hybrid")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama.test")
    respx.post("http://ollama.test/api/chat").mock(return_value=httpx.Response(500))
    analysis = analyze_advisory_engine(WEALTH)
    assert analysis.engine == "rules"
    assert analysis.probability == analyze_advisory(WEALTH).probability


@respx.mock
def test_hybrid_skips_llm_without_signals(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("M3_ENGINE", "hybrid")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama.test")
    route = respx.post("http://ollama.test/api/chat")
    analyze_advisory_engine("Kurs złotego spadł w piątek o 0,3%.")
    assert route.call_count == 0


def test_analyze_endpoint_m3(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("M3_ENGINE", raising=False)
    response = client.post(
        "/analyze",
        json={"material_id": "m1", "module": "unauthorized_advisory", "text": WEALTH, "rules": []},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["label"] == POSITIVE_LABEL
    assert body["probability"] == 0.85
    assert body["error"] is None
    assert body["subject"]["name"] == "Kowalski Wealth Partners sp. z o.o."
    assert body["signals"]["offer"] == 0.85
    assert body["findings"][0]["rule_id"] == ADVISORY_RULE
    scores = body["rule_scores"]
    assert scores[ADVISORY_RULE]["score"] == round(body["probability"], 3)
    assert scores["M3.offer"] == {"p_violation": 0.85, "weight": 1.0, "score": 0.85}
    assert {s["weight"] for s in scores.values()} == {1.0}
    assert scores["M3.claims"]["score"] == 0


def test_rule_scores_follow_findings() -> None:
    analysis = analyze_advisory(FINFLUENCER)
    scores = rule_scores(analysis.findings)
    assert scores[ADVISORY_RULE].score == analysis.probability
    assert all(s.score <= s.p_violation for s in scores.values())
    assert set(scores) == {f.rule_id for f in analysis.findings}


def test_analyze_endpoint_m3_negative_probability_is_for_label() -> None:
    body = client.post(
        "/analyze",
        json={"material_id": "m1", "module": "unauthorized_advisory", "text": FINFLUENCER},
    ).json()
    assert body["label"] == NEGATIVE_LABEL
    assert body["probability"] > 0.8


def test_analyze_endpoint_m3_unknown_rule() -> None:
    response = client.post(
        "/analyze",
        json={"material_id": "m1", "module": "unauthorized_advisory", "text": "x", "rules": ["3"]},
    )
    assert response.status_code == 422


def test_subject_skips_author_bio() -> None:
    text = (
        "Autor był wcześniej Dyrektorem Finansowym Mennicy Polskiej S.A.\n"
        "Kurs inwestowania dla początkujących.\n"
        "FinCrafters sp. z o.o., ul. Prosta 1, Warszawa"
    )
    assert extract_subject(text).name == "FinCrafters sp. z o.o."
    assert (
        extract_subject("Był Prezesem Zarządu Banku XYZ S.A. przez 10 lat. " * 1 + "x" * 200).name
        is None
    )


@pytest.mark.parametrize(
    ("signals", "expected"),
    [
        ({"offer": 0.9, "recommendation": 0.0, "personal": 0.0}, 0.0),
        ({"offer": 0.0, "recommendation": 0.9, "personal": 0.9}, 0.0),
        ({"offer": 0.9, "recommendation": 0.6, "personal": 0.0}, 0.6),
        ({"offer": 0.7, "recommendation": 0.2, "personal": 0.9}, 0.7),
        ({"offer": 0.9, "paid": 0.9, "claims": 0.9}, 0.0),
    ],
)
def test_probability_is_offer_and_any_of(signals: dict[str, float], expected: float) -> None:
    assert probability(signals) == expected


def test_advisory_quote_comes_from_condition_not_payment() -> None:
    finding = next(f for f in analyze_advisory(WEALTH).findings if f.rule_id == ADVISORY_RULE)
    paid = next(f for f in analyze_advisory(WEALTH).findings if f.rule_id == "M3.paid")
    assert finding.quote is not None
    assert finding.quote != paid.quote


@respx.mock
def test_hybrid_skips_llm_without_offer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("M3_ENGINE", "hybrid")
    monkeypatch.setenv("OLLAMA_URL", "http://ollama.test")
    route = respx.post("http://ollama.test/api/chat")
    analyze_advisory_engine(FINFLUENCER)
    assert route.call_count == 0
