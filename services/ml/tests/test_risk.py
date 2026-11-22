# ruff: noqa: E501, RUF001 — próbki reklam w jednej linii, z typografią jak w prawdziwych tekstach
import json
import math

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from ml.main import app
from ml.risk import (
    TEXT_RULES,
    Finding,
    Result,
    analyze_risk_disclosure,
    max_rule_score,
    risk_score,
)
from ml.risk_llm import (
    analyze_risk_disclosure_hybrid,
    analyze_risk_disclosure_llm,
    answer_probabilities,
    calibrate,
    verify_quote,
)

client = TestClient(app)

BAD_AD = """Zarabiaj do 300% rocznie z kontami CFD!
W 2024 roku nasz fundusz zarobił +42%.
Prognozujemy, że w 2027 osiągniemy jeszcze więcej.
Nasza inwestycja jest w pełni bezpieczna – spełniamy rygorystyczne wymogi nadzorcze KNF.
Inwestuj bez podatku Belki w IKE."""

GOOD_AD = """Materiał marketingowy. XYZ Dom Maklerski S.A.
Stopa zwrotu funduszu w 2024 roku wyniosła 8%, a inwestycja wiąże się z ryzykiem utraty części lub całości zainwestowanego kapitału.
Źródło: dane własne, okres referencyjny 01.01.2020–31.12.2024. Wyniki nie uwzględniają opłat i prowizji, a zmiany kursów walut mogą wpłynąć na wynik.
Wyniki historyczne nie stanowią gwarancji osiągnięcia podobnych wyników w przyszłości."""


def results(text: str) -> dict[str, str]:
    return {f.rule_id: f.result for f in analyze_risk_disclosure(text).findings}


def test_bad_ad_flags_text_rules() -> None:
    r = results(BAD_AD)
    for rule in ("1", "2", "3", "12a", "12b", "14", "15", "16", "18"):
        assert r[rule] == "violation", rule
    assert r["11"] == "n/a"


def test_compliant_ad_passes() -> None:
    r = results(GOOD_AD)
    for rule in ("1", "2", "3", "12a", "12b", "14"):
        assert r[rule] == "ok", rule
    for rule in ("15", "16", "17", "18"):
        assert r[rule] == "n/a", rule


def test_risk_warning_far_from_gain_claim_violates_rule_3() -> None:
    text = "Zarabiaj do 50% rocznie!\n" + "Opis oferty.\n" * 6 + "Ryzyko utraty kapitału."
    finding = next(f for f in analyze_risk_disclosure(text).findings if f.rule_id == "3")
    assert finding.result == "violation"
    assert finding.quote == "Zarabiaj do 50% rocznie!"


def test_violation_quotes_are_verbatim() -> None:
    for finding in analyze_risk_disclosure(BAD_AD).findings:
        if finding.result == "violation":
            assert finding.quote and finding.quote in BAD_AD


def test_risk_score_combines_all_rules_with_decay() -> None:
    findings = [
        Finding("10", "violation", 0.8, "x", ""),
        Finding("3", "violation", 0.9, "y", ""),
        Finding("14", "ok", 0.99, None, ""),
    ]
    # 1 - (1 - 0.9) * (1 - 0.8 * 0.5) * (1 - 0.01 * 0.25)
    assert risk_score(findings) == pytest.approx(1 - 0.1 * 0.6 * (1 - 0.0025), abs=1e-3)
    assert risk_score(findings[1:2]) == 0.9  # jedna reguła: score reguły
    assert risk_score([]) == 0.0
    # Próg działa na regułach: incydent przy t ⇔ któraś reguła >= t ⇔ max_rule_score >= t.
    assert max_rule_score(findings) == 0.9


def test_risk_score_keeps_violation_probability_when_ok_wins() -> None:
    probabilities: dict[Result, float] = {"violation": 0.45, "ok": 0.5, "n/a": 0.05}
    finding = Finding("3", "ok", 0.5, None, "", probabilities)
    assert risk_score([finding]) == 0.45


def test_verify_quote_rejects_paraphrase() -> None:
    assert verify_quote("Zarabiaj do 300% rocznie", BAD_AD) == "Zarabiaj do 300% rocznie"
    assert verify_quote("Zarabiaj nawet 300% w rok", BAD_AD) is None


def test_answer_probabilities_group_tokens_by_first_letter() -> None:
    top = [
        {"token": "T", "logprob": math.log(0.5)},
        {"token": "TA", "logprob": math.log(0.1)},
        {"token": "NIE", "logprob": math.log(0.3)},
        {"token": "BRAK", "logprob": math.log(0.1)},
        {"token": "Hmm", "logprob": math.log(0.01)},
    ]
    p = answer_probabilities(top)
    assert p["violation"] == pytest.approx(0.6)
    assert p["ok"] == pytest.approx(0.3)
    assert p["n/a"] == pytest.approx(0.1)


def _logprobs(answer: str, p: float) -> dict:
    rest = (1 - p) / 2
    others = [t for t in ("TAK", "NIE", "BRAK") if t != answer]
    top = [{"token": answer, "logprob": math.log(p)}]
    top += [{"token": t, "logprob": math.log(rest)} for t in others]
    return {"message": {"content": answer}, "logprobs": [{"token": answer, "top_logprobs": top}]}


@respx.mock
def test_llm_engine_uses_logprobs_and_drops_invented_quotes() -> None:
    answers = {"3": ("TAK", 0.9), "15": ("TAK", 0.8)}

    def reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if "format" in body:
            explain = {"findings": [
                {"rule_id": "3", "quote": "Zarabiaj do 300% rocznie", "reason": "Brak ryzyka."},
                {"rule_id": "15", "quote": "zmyślony cytat którego nie ma", "reason": "Prognoza."},
            ]}  # fmt: skip
            return httpx.Response(200, json={"message": {"content": json.dumps(explain)}})
        question = body["messages"][-1]["content"]
        rule = question.split("Reguła ")[1].split(":")[0]
        answer, p = answers.get(rule, ("BRAK", 0.7))
        return httpx.Response(200, json=_logprobs(answer, p))

    respx.post("http://ollama.test/api/chat").mock(side_effect=reply)
    analysis = analyze_risk_disclosure_llm(BAD_AD, ollama_url="http://ollama.test", model="m")
    by_rule = {f.rule_id: f for f in analysis.findings}
    assert set(by_rule) == set(TEXT_RULES)
    assert by_rule["3"].result == "violation"
    assert by_rule["3"].confidence == pytest.approx(0.9)
    assert by_rule["3"].quote == "Zarabiaj do 300% rocznie"
    assert by_rule["15"].quote is None
    assert by_rule["15"].confidence == pytest.approx(0.48)
    assert by_rule["16"].result == "n/a"


def test_analyze_endpoint_returns_contract_shape() -> None:
    response = client.post(
        "/analyze",
        json={"material_id": "m1", "module": "risk_disclosure", "text": BAD_AD, "rules": ["3"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["label"] is None and body["probability"] is None and body["error"] is None
    assert [f["rule_id"] for f in body["findings"]] == ["3"]
    assert body["findings"][0]["result"] == "violation"
    assert set(body["rule_scores"]) == {"3"}
    rule = body["rule_scores"]["3"]
    assert rule["score"] == pytest.approx(rule["weight"] * rule["p_violation"], abs=1e-3)
    assert body["risk_score"] == rule["score"]
    assert body["max_rule_score"] == rule["score"]


def test_analyze_rejects_unknown_rules() -> None:
    response = client.post(
        "/analyze",
        json={"material_id": "m1", "module": "risk_disclosure", "text": "x", "rules": ["99"]},
    )
    assert response.status_code == 422


def test_analyze_other_modules_report_error() -> None:
    response = client.post(
        "/analyze", json={"material_id": "m1", "module": "finfluencer", "text": "x"}
    )
    assert response.status_code == 200
    assert response.json()["error"]


@respx.mock
def test_hybrid_asks_llm_only_about_applicable_rules() -> None:
    asked: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        question = json.loads(request.content)["messages"][-1]["content"]
        rule = question.split("Reguła ")[1].split(":")[0]
        asked.append(rule)
        answer, p = ("TAK", 0.8) if rule == "3" else ("NIE", 0.9)
        return httpx.Response(200, json=_logprobs(answer, p))

    respx.post("http://ollama.test/api/chat").mock(side_effect=reply)
    text = "XYZ Dom Maklerski S.A.\nZarabiaj do 50% rocznie!\n" + "Opis oferty.\n" * 6
    analysis = analyze_risk_disclosure_hybrid(text, ollama_url="http://ollama.test", model="m")
    by_rule = {f.rule_id: f for f in analysis.findings}

    # Brak wyników historycznych, prognoz, podatków, KNF i ostrzeżenia: regex mówi „nie dotyczy”.
    assert set(asked) == {"1", "2", "3"}
    for rule in ("9", "10", "12a", "14", "15", "16", "17", "18"):
        assert by_rule[rule].result == "n/a"
    assert by_rule["3"].result == "violation"
    assert by_rule["3"].probabilities is not None
    assert by_rule["3"].probabilities["violation"] == pytest.approx(calibrate(0.8 / (0.8 + 0.1)))
    assert by_rule["3"].quote == "Zarabiaj do 50% rocznie!"


def test_calibration_spreads_scores_but_keeps_order_and_midpoint() -> None:
    assert calibrate(0.5) == pytest.approx(0.5)
    assert calibrate(0.99) < 0.99
    assert calibrate(0.01) > 0.01
    assert calibrate(0.9999) > calibrate(0.99) > calibrate(0.7) > calibrate(0.3)
    assert calibrate(0.99) == pytest.approx(1 / (1 + (0.01 / 0.99) ** 0.5))


def test_gain_claim_with_distant_object_and_return_rates() -> None:
    text = "Inwestuj globalnie i zyskaj możliwość osiągnięcia ponadprzeciętnych zysków.\nSprawdź"
    assert results(text)["3"] == "violation"
    returns = "Stopa zwrotu za 1 rok na dzień 2026-11-19\nFundusz Akcji 30,93%"
    assert results(returns)["3"] == "violation"
    assert results("Zyskaj pełną kontrolę nad inwestycjami.")["3"] == "n/a"


def test_rule_10_ignores_warning_when_detecting_page_language() -> None:
    warning = (
        "CFDs are complex instruments and come with a high risk of losing money rapidly due to "
        "leverage. 74% of retail investor accounts lose money when trading CFDs with this provider. "
        "You should consider whether you can afford to take the high risk of losing your money."
    )
    text = f"{warning}\nHandluj na rynkach globalnych.\nOtwórz konto w kilka minut."
    assert results(text)["10"] == "violation"
