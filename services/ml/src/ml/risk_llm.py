# ruff: noqa: E501 — treść reguł i promptów czyta się lepiej w jednej linii
"""Moduł 2 przez LLM (Ollama, np. Bielik-PL-11B z polskim tokenizerem APT4).

Prawdopodobieństwo naruszenia bierzemy z wnętrza modelu, nie z jego deklaracji:
1. dla każdej reguły pytanie „czy tekst narusza regułę?” z odpowiedzią jednym słowem:
   TAK (narusza), NIE (spełnia), BRAK (reguła nie dotyczy),
2. z logprobs pierwszego tokenu sumujemy prawdopodobieństwo tokenów zaczynających się na T, N i B
   (słowo bywa dzielone na tokeny „T”, „TA”…), normalizujemy do sumy 1,
3. result = odpowiedź o najwyższym P, confidence = jej P.

Tekst materiału jest na początku promptu, a reguła na końcu — Ollama ponownie używa policzonego
prefiksu (cache KV), więc 13 pytań o ten sam materiał przetwarza tekst raz.
Cytat i uzasadnienie: jedno dodatkowe wywołanie tylko dla naruszeń; cytat musi dosłownie
występować w tekście, zmyślony jest usuwany, a pewność naruszenia obniżana.
"""

import json
import math
import os
import re
from typing import Any

import httpx

from ml.risk import (
    TEXT_RULES,
    Finding,
    Result,
    RiskAnalysis,
    analyze_risk_disclosure,
    split_paragraphs,
    summarize,
)

DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_MODEL = "bielik-pl-11b-apt4:Q4_K_M"
# Początek strony to zwykle przekaz reklamowy, a stopka z ostrzeżeniami na końcu — bierzemy oba.
MAX_CHARS = 7000
NUM_CTX = 8192
TIMEOUT = httpx.Timeout(180.0, connect=10.0)
UNVERIFIED_QUOTE_PENALTY = 0.6
# ~120 tokenów na naruszenie (cytat do 200 znaków + zdanie uzasadnienia).
EXPLAIN_MAX_TOKENS = 600

RULE_TEXT: dict[str, str] = {
    "1": "Identyfikacja firmy: materiał musi zawierać oficjalną nazwę firmy inwestycyjnej.",
    "2": "Oznaczenie reklamy: materiał reklamowy musi być jednoznacznie oznaczony jako reklama lub materiał marketingowy.",
    "3": "Informacja o ryzyku: każdemu twierdzeniu o potencjalnych zyskach musi bezpośrednio towarzyszyć informacja o istotnym ryzyku.",
    "9": "Zrozumiałość: ostrzeżenie o ryzyku musi być napisane językiem zrozumiałym dla przeciętnego klienta.",
    "10": "Spójność językowa: informacja o ryzyku musi być w tym samym języku co główny przekaz materiału.",
    "11": "Porównania: porównanie produktów lub usług musi podawać źródło informacji i przyjęte założenia.",
    "12a": "Wyniki historyczne muszą obejmować ostatnie 5 lat w pełnych okresach 12-miesięcznych oraz wskazywać okres referencyjny i źródło.",
    "12b": "Przy wynikach historycznych musi być ostrzeżenie o wpływie kursów walut oraz informacja o wpływie prowizji i opłat.",
    "14": "Przy wynikach historycznych musi być wyraźne zastrzeżenie, że nie są one wiarygodnym wskaźnikiem przyszłych wyników.",
    "15": "Prognozie przyszłych wyników musi towarzyszyć wyraźne ostrzeżenie, że nie jest ona wiarygodnym wskaźnikiem.",
    "16": "Przy odwołaniu do traktowania podatkowego musi być informacja, że zależy ono od indywidualnej sytuacji klienta i może się zmienić.",
    "17": "Odwołanie do KNF lub innego organu nadzoru nie może sugerować, że organ zatwierdził lub poleca produkt lub usługę.",
    "18": "Nadzór KNF nie może być używany jako argument, że inwestycja jest bezpieczna.",
}  # fmt: skip

# Reguły warunkowe: kiedy odpowiedzieć BRAK.
_NOT_APPLICABLE_HINT: dict[str, str] = {
    "3": "BRAK, jeśli tekst nie zawiera twierdzeń o zyskach.",
    "9": "BRAK, jeśli tekst nie zawiera ostrzeżenia o ryzyku.",
    "10": "BRAK, jeśli tekst nie zawiera ostrzeżenia o ryzyku.",
    "11": "BRAK, jeśli tekst nie porównuje produktów ani usług.",
    "12a": "BRAK, jeśli tekst nie prezentuje wyników historycznych.",
    "12b": "BRAK, jeśli tekst nie prezentuje wyników historycznych.",
    "14": "BRAK, jeśli tekst nie prezentuje wyników historycznych.",
    "15": "BRAK, jeśli tekst nie zawiera prognoz przyszłych wyników.",
    "16": "BRAK, jeśli tekst nie odwołuje się do podatków.",
    "17": "BRAK, jeśli tekst nie wspomina o KNF ani innym organie nadzoru.",
    "18": "BRAK, jeśli tekst nie wspomina o KNF ani innym organie nadzoru.",
}

SYSTEM_PROMPT = (
    "Jesteś analitykiem Urzędu Komisji Nadzoru Finansowego. Oceniasz tekst strony internetowej "
    "firmy inwestycyjnej pod kątem wymogów art. 44 rozporządzenia delegowanego 2017/565. "
    "Odpowiadasz rzetelnie, tylko na podstawie podanego tekstu."
)

_ANSWER_LETTER: dict[str, Result] = {"T": "violation", "N": "ok", "B": "n/a"}

_EXPLAIN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "rule_id": {"type": "string"},
                    "quote": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["rule_id", "quote", "reason"],
            },
        }
    },
    "required": ["findings"],
}

_WS = re.compile(r"\s+")


class LlmError(Exception):
    pass


def _clip(text: str) -> str:
    if len(text) <= MAX_CHARS:
        return text
    head = text[: MAX_CHARS * 2 // 3]
    tail = text[-MAX_CHARS // 3 :]
    return f"{head}\n[…]\n{tail}"


def _material_message(text: str) -> str:
    return f'Tekst do oceny:\n"""\n{_clip(text)}\n"""\n\n'


def _question(rule_id: str) -> str:
    hint = _NOT_APPLICABLE_HINT.get(rule_id, "")
    return (
        f"Reguła {rule_id}: {RULE_TEXT[rule_id]}\n"
        f"Czy tekst narusza tę regułę? {hint}\n"
        "Odpowiedz jednym słowem: TAK (narusza), NIE (spełnia) albo BRAK (nie dotyczy)."
    )


def verify_quote(quote: str | None, text: str) -> str | None:
    """Zwraca cytat w brzmieniu z tekstu albo None, gdy model go zmyślił lub sparafrazował."""
    if not quote:
        return None
    needle = _WS.sub(" ", quote.strip(" \"„”'…")).lower()
    if len(needle) < 8:
        return None
    for paragraph in split_paragraphs(text):
        haystack = _WS.sub(" ", paragraph)
        index = haystack.lower().find(needle)
        if index >= 0:
            return haystack[index : index + len(needle)][:300]
    return None


def answer_probabilities(top_logprobs: list[dict[str, Any]]) -> dict[Result, float]:
    """P(violation), P(ok), P(n/a) z top logprobs pierwszego tokenu (po pierwszej literze)."""
    mass: dict[Result, float] = {"violation": 0.0, "ok": 0.0, "n/a": 0.0}
    for candidate in top_logprobs:
        token = str(candidate.get("token", "")).strip().upper()
        result = _ANSWER_LETTER.get(token[:1]) if token else None
        if result is not None:
            mass[result] += math.exp(float(candidate["logprob"]))
    total = sum(mass.values())
    if total == 0:
        raise LlmError("Model nie odpowiedział TAK/NIE/BRAK")
    return {result: value / total for result, value in mass.items()}


class _Ollama:
    def __init__(self, url: str, model: str, client: httpx.Client) -> None:
        self.url = url
        self.model = model
        self.client = client

    def chat(self, messages: list[dict[str, str]], **extra: Any) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
            "stream": False,
            **extra,
        }
        try:
            response = self.client.post(f"{self.url}/api/chat", json=payload)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise LlmError(f"Ollama: {exc}") from exc

    def classify(self, text: str, rule_id: str) -> dict[Result, float]:
        body = self.chat(
            [{"role": "user", "content": _material_message(text) + _question(rule_id)}],
            logprobs=True,
            top_logprobs=20,
            options={"temperature": 0, "num_predict": 1, "num_ctx": NUM_CTX},
        )
        try:
            top = body["logprobs"][0]["top_logprobs"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LlmError(
                "Ollama nie zwróciła logprobs (wymagana wersja z obsługą logprobs)"
            ) from exc
        return answer_probabilities(top)

    def explain(self, text: str, rule_ids: list[str]) -> dict[str, dict[str, str]]:
        rules = "\n".join(f"Reguła {r}: {RULE_TEXT[r]}" for r in rule_ids)
        prompt = (
            _material_message(text) + f"Te reguły zostały naruszone:\n{rules}\n\n"
            "Dla każdej podaj DOSŁOWNY fragment tekstu (do 200 znaków), który pokazuje naruszenie, "
            "i jedno krótkie zdanie uzasadnienia po polsku."
        )
        schema = json.loads(json.dumps(_EXPLAIN_SCHEMA))
        schema["properties"]["findings"]["maxItems"] = len(rule_ids)
        schema["properties"]["findings"]["items"]["properties"]["rule_id"]["enum"] = rule_ids
        body = self.chat(
            [{"role": "user", "content": prompt}],
            format=schema,
            # Bez limitu model potrafi zapętlić tablicę JSON na tysiące tokenów.
            options={"temperature": 0, "num_ctx": NUM_CTX, "num_predict": EXPLAIN_MAX_TOKENS},
        )
        try:
            parsed = json.loads(body["message"]["content"])
            items = parsed["findings"]
        except (KeyError, TypeError, json.JSONDecodeError):
            return {}
        return {str(i.get("rule_id")): i for i in items if isinstance(i, dict)}


def analyze_risk_disclosure_llm(
    text: str,
    rules: list[str] | None = None,
    *,
    model: str | None = None,
    ollama_url: str | None = None,
    client: httpx.Client | None = None,
) -> RiskAnalysis:
    url = (ollama_url or os.environ.get("OLLAMA_URL") or DEFAULT_OLLAMA_URL).rstrip("/")
    name = model or os.environ.get("OLLAMA_RISK_MODEL") or DEFAULT_MODEL
    http = client or httpx.Client(timeout=TIMEOUT)
    try:
        ollama = _Ollama(url, name, http)
        requested = [r for r in TEXT_RULES if rules is None or r in rules]
        probabilities = {rule_id: ollama.classify(text, rule_id) for rule_id in requested}
        violated = [r for r, p in probabilities.items() if max(p, key=p.__getitem__) == "violation"]
        explanations = ollama.explain(text, violated) if violated else {}
    finally:
        if client is None:
            http.close()

    findings: list[Finding] = []
    for rule_id, p in probabilities.items():
        result = max(p, key=p.__getitem__)
        confidence = p[result]
        explanation = explanations.get(rule_id, {})
        quote = verify_quote(explanation.get("quote"), text) if result == "violation" else None
        if result == "violation" and quote is None:
            # KONTRAKT §2: cytat obowiązkowy przy naruszeniu — bez niego obniżamy pewność.
            confidence *= UNVERIFIED_QUOTE_PENALTY
        reason = str(explanation.get("reason", "")).strip()[:300] or (
            f"P(narusza)={p['violation']:.2f}, P(spełnia)={p['ok']:.2f}, P(nie dotyczy)={p['n/a']:.2f}"
        )
        findings.append(Finding(rule_id, result, round(confidence, 3), quote, reason, p))
    return RiskAnalysis(findings=findings, summary=summarize(findings))


# --- Wariant łączony: regex decyduje, czy reguła dotyczy; Bielik ocenia naruszenie -------------

# Reguły oceniane na całym tekście (dotyczą materiału jako całości, nie konkretnego miejsca).
_GLOBAL_RULES = frozenset({"1", "2"})
WINDOW_RADIUS = 2  # akapity przed i po znalezionym miejscu


def _window(text: str, quote: str | None) -> str:
    """Fragment wokół cytatu z regexa (akapit ± WINDOW_RADIUS); bez cytatu — przycięty tekst."""
    paragraphs = split_paragraphs(text)
    if quote:
        for i, paragraph in enumerate(paragraphs):
            if quote in paragraph:
                start = max(0, i - WINDOW_RADIUS)
                return "\n".join(paragraphs[start : i + WINDOW_RADIUS + 1])
    return _clip(text)


def _binary_question(rule_id: str) -> str:
    return (
        f"Reguła {rule_id}: {RULE_TEXT[rule_id]}\n"
        "Czy tekst narusza tę regułę? Odpowiedz jednym słowem: TAK (narusza) albo NIE (spełnia)."
    )


def binary_probability(top_logprobs: list[dict[str, Any]]) -> float:
    """P(TAK) / (P(TAK) + P(NIE)) z top logprobs pierwszego tokenu."""
    p = answer_probabilities(top_logprobs)
    total = p["violation"] + p["ok"]
    if total == 0:
        raise LlmError("Model nie odpowiedział TAK/NIE")
    return p["violation"] / total


def analyze_risk_disclosure_hybrid(
    text: str,
    rules: list[str] | None = None,
    *,
    model: str | None = None,
    ollama_url: str | None = None,
    client: httpx.Client | None = None,
) -> RiskAnalysis:
    base = analyze_risk_disclosure(text, rules)
    by_rule = {f.rule_id: f for f in base.findings}
    # Reguła 9 (zrozumiałość ostrzeżenia) dotyczy materiału, gdy regex znalazł ostrzeżenie (reguła 10).
    warning = by_rule.get("10") or analyze_risk_disclosure(text, ["10"]).findings[0]

    def applicable(rule_id: str) -> bool:
        if rule_id == "9":
            return warning.result != "n/a"
        finding = by_rule[rule_id]
        return finding.result != "n/a"

    url = (ollama_url or os.environ.get("OLLAMA_URL") or DEFAULT_OLLAMA_URL).rstrip("/")
    name = model or os.environ.get("OLLAMA_RISK_MODEL") or DEFAULT_MODEL
    http = client or httpx.Client(timeout=TIMEOUT)
    findings: list[Finding] = []
    try:
        ollama = _Ollama(url, name, http)
        for finding in base.findings:
            rule_id = finding.rule_id
            if rule_id not in TEXT_RULES or not applicable(rule_id):
                findings.append(finding)
                continue
            anchor = warning.quote if rule_id == "9" else finding.quote
            context = _clip(text) if rule_id in _GLOBAL_RULES else _window(text, anchor)
            body = ollama.chat(
                [
                    {
                        "role": "user",
                        "content": _material_message(context) + _binary_question(rule_id),
                    }
                ],
                logprobs=True,
                top_logprobs=20,
                options={"temperature": 0, "num_predict": 1, "num_ctx": NUM_CTX},
            )
            try:
                top = body["logprobs"][0]["top_logprobs"]
            except (KeyError, IndexError, TypeError) as exc:
                raise LlmError("Ollama nie zwróciła logprobs") from exc
            p = binary_probability(top)
            result: Result = "violation" if p >= 0.5 else "ok"
            probabilities: dict[Result, float] = {"violation": p, "ok": 1 - p, "n/a": 0.0}
            reason = (
                finding.reason
                if result == finding.result
                else (f"Ocena modelu: P(narusza)={p:.2f}.")
            )
            findings.append(
                Finding(rule_id, result, round(max(p, 1 - p), 3), anchor, reason, probabilities)
            )
    finally:
        if client is None:
            http.close()
    return RiskAnalysis(findings=findings, summary=summarize(findings))
