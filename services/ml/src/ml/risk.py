# ruff: noqa: E501 — tabela wzorców regex i komunikatów czyta się lepiej w jednej linii
"""Moduł 2: ocena informacji o ryzyku w materiałach marketingowych (reguły UKNF, docs/materialy-uknf).

Najprostszy wariant, bez LLM:
1. tekst → akapity (linie z `normalize_text`),
2. dla każdego akapitu score 0-1 każdej cechy (obietnica zysku, ostrzeżenie o ryzyku, wyniki
   historyczne…) z fraz regex — score cechy = najwyższa waga pasującej frazy,
3. reguła = wzór na score'ach cech, np. reguła 14: P(naruszenie) = wyniki · (1 - zastrzeżenie),
4. wynik reguły (`violation` | `ok` | `n/a`), pewność i dosłowny cytat (docs/KONTRAKT.md §2).

Reguły wymagające renderowania strony (4-8, 13) i oceny językowej (9) zwracają `n/a`.
Score materiału liczy backend z `findings`.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

Result = Literal["violation", "ok", "n/a"]

RULE_IDS: tuple[str, ...] = (
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    "11", "12a", "12b", "13", "14", "15", "16", "17", "18",
)  # fmt: skip

# Reguły oceniane z samego tekstu (pozostałe wymagają renderowania strony).
TEXT_RULES: tuple[str, ...] = (
    "1", "2", "3", "9", "10", "11", "12a", "12b", "14", "15", "16", "17", "18",
)  # fmt: skip

# Waga reguły w risk_score. Reguły merytoryczne (3-18) ważą tyle samo: każde naruszenie art. 44
# jest tak samo istotne, a w ewaluacji (scripts/eval_m2.py) równe wagi wypadły nie gorzej niż
# ręcznie dobrane. Reguły formalne 1 i 2 (nazwa firmy, oznaczenie reklamy) mają 0,3, żeby same nie
# przekraczały progu 0,5: na stronach WWW brak napisu „reklama” jest prawie wszędzie.
# Hierarchię wag warto potwierdzić z UKNF.
RULE_WEIGHTS: dict[str, float] = {
    "1": 0.3, "2": 0.3, "3": 1.0, "9": 1.0, "10": 1.0, "11": 1.0, "12a": 1.0, "12b": 1.0,
    "14": 1.0, "15": 1.0, "16": 1.0, "17": 1.0, "18": 1.0,
}  # fmt: skip

# Poniżej tej wartości warunek wstępny reguły (np. „są wyniki historyczne”) uznajemy za niespełniony.
APPLICABLE_MIN = 0.3
VIOLATION_MIN = 0.5
QUOTE_MAX = 300

_NOT_EVALUATED: dict[str, str] = {
    "4": "Wymaga renderowania strony (rozmiar czcionki) — nieoceniane w tej wersji.",
    "5": "Wymaga renderowania strony (kontrast, przesłonięcie) — nieoceniane w tej wersji.",
    "6": "Wymaga renderowania strony (widoczność ostrzeżenia) — nieoceniane w tej wersji.",
    "7": "Wymaga renderowania strony (ostrzeżenie za kliknięciem) — nieoceniane w tej wersji.",
    "8": "Wymaga renderowania na różnych ekranach — nieoceniane w tej wersji.",
    "9": "Wymaga oceny językowej (LLM) — nieoceniane w tej wersji.",
    "13": "Wymaga układu strony (ekspozycja wyników) — nieoceniane w tej wersji.",
}

_F = re.IGNORECASE | re.UNICODE
_W = r"[\wąćęłńóśźż]"  # \w w Pythonie obejmuje polskie litery, alias dla czytelności wzorców


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, _F)


# Cecha → lista (wzorzec, waga). Waga = pewność, że dopasowanie oznacza tę cechę.
_FEATURES: dict[str, list[tuple[re.Pattern[str], float]]] = {
    "gain_claim": [
        (_p(r"gwarant\w*\s+(?:zysk|zwrot|dochód|oprocentowani)\w*"), 0.95),
        (_p(r"\d+(?:[.,]\d+)?\s?%[^.\n]{0,40}(?:zysk|zwrot|rocznie|w skali roku|p\.\s?a\.|miesięcznie)"), 0.9),
        (_p(r"(?:zysk|zwrot|zarobi|zarabia|dochód|stopa zwrotu)\w*[^.\n]{0,30}\d+(?:[.,]\d+)?\s?%"), 0.9),
        (_p(r"\b(?:zarabiaj|zarób|zarobisz|zarobić|pomnóż|podwój|zyskaj|zyskasz)\b"), 0.8),
        (_p(r"\bbez ryzyka\b|\bwoln\w+ od ryzyka\b|\bpewn\w+ zysk\w*"), 0.9),
        (_p(r"\b(?:zysk\w*|stop\w+ zwrotu|rentowność|dochod\w*|oprocentowani\w*)\b"), 0.35),
    ],
    "risk_warning": [
        (_p(r"\d+(?:[.,]\d+)?\s?%\s+rachunków\s+inwestorów\s+detalicznych\s+traci\s+pieniądze"), 0.99),
        (_p(r"ryzyk\w*\s+utraty\s+(?:części\s+lub\s+całości\s+|całości\s+|części\s+)?"
            r"(?:zainwestowan\w+\s+)?(?:kapitał|środk|pieniędzy)\w*"), 0.97),
        (_p(r"możesz\s+(?:stracić|utracić)|może(?:sz)?\s+ponieść\s+strat"), 0.95),
        (_p(r"wiąż\w+\s+się\s+z\s+(?:wysokim\s+|istotnym\s+)?ryzykiem"), 0.9),
        (_p(r"\b(?:lose|losing)\s+(?:money|your\s+capital)|risk\s+of\s+(?:loss|losing)"
            r"|high\s+risk\s+of\s+losing"), 0.9),
        (_p(r"(?<!bez )(?<!wolne od )(?<!wolny od )\bryzyk\w*"), 0.5),
    ],
    "ad_label": [
        (_p(r"\b(?:materiał|komunikat)\s+(?:reklamowy|marketingowy|promocyjny)"), 0.97),
        (_p(r"#?\breklama\b|\bsponsorowan\w+|#ad\b|\bmarketing communication\b"), 0.9),
    ],
    "firm_name": [
        (_p(r"\b(?:dom|biuro)\s+maklerski\w*|towarzystw\w+\s+funduszy\s+inwestycyjnych"), 0.9),
        (_p(r"\bS\.\s?A\.(?!\w)|\bsp\.\s?z\s?o\.\s?o\.|\bspółk\w+\s+akcyjn\w+"), 0.8),
        (_p(r"\b(?:Ltd|Limited|GmbH|AG|SE|N\.V\.|B\.V\.|plc)\b\.?"), 0.75),
    ],
    "historical_results": [
        (_p(r"\b(?:wyniki|stopy\s+zwrotu)\s+(?:historyczn|osiągnięt|z\s+przeszłości)\w*"), 0.9),
        (_p(r"(?:w|za)\s+(?:roku\s+)?(?:19|20)\d{2}[^.\n]{0,50}[+-]?\d+(?:[.,]\d+)?\s?%"), 0.85),
        (_p(r"[+-]?\d+(?:[.,]\d+)?\s?%[^.\n]{0,50}(?:w|za)\s+(?:roku\s+)?(?:19|20)\d{2}"), 0.85),
        (_p(r"(?:w\s+ciągu|przez|w)\s+ostatni\w+\s+\d+\s+(?:lat|latach|miesięcy|miesiącach)"), 0.7),
        (_p(r"\bod\s+początku\s+roku\b|\bYTD\b|\bpast\s+performance\b"), 0.7),
    ],
    "hist_period_source": [
        (_p(r"\bźródło\s*:|\bwedług\s+danych|\bna\s+podstawie\s+danych|\bdane\s+za\s+okres"), 0.85),
        (_p(r"\bokres\w*\s+referencyjn\w*|\bod\s+\d{1,2}\.\d{1,2}\.\d{4}\s+do\s+\d{1,2}\.\d{1,2}\.\d{4}"), 0.85),
        (_p(r"\b(?:5|pięciu|pięć)\s+(?:lat|latach)\b|\b60\s+miesięcy\b"), 0.6),
    ],
    "currency_fees": [
        (_p(r"(?:zmian\w*|wahani\w*)\s+kurs\w*\s+walut|ryzyk\w*\s+walutow\w*"), 0.9),
        (_p(r"(?:po\s+(?:uwzględnieniu|odliczeniu)|nie\s+uwzględnia\w*|uwzględnia\w*|bez\s+uwzględnienia)"
            r"\s+(?:\w+\s+){0,3}(?:opłat|prowizj|koszt|obciążeń)\w*"), 0.9),
    ],
    "hist_disclaimer": [
        (_p(r"(?:wyniki|stopy\s+zwrotu)[^.\n]{0,80}nie\s+(?:są|stanowią|gwarantują)[^.\n]{0,60}"
            r"(?:przyszł|gwarancj|wskaźnik)\w*"), 0.95),
        (_p(r"nie\s+(?:stanowią|są)\s+(?:gwarancją|wiarygodnym\s+wskaźnikiem)\s+(?:osiągnięcia\s+)?"
            r"(?:podobnych\s+|przyszłych\s+)?(?:wyników|zysków)"), 0.95),
        (_p(r"past\s+performance\s+is\s+not\s+(?:a\s+)?(?:reliable\s+)?(?:indicator|guarantee)"), 0.95),
    ],
    "forecast": [
        (_p(r"\bprognoz\w*|\bprzewidujemy\b|\bprzewidywan\w+\s+(?:zysk|zwrot|wzrost)\w*"), 0.85),
        (_p(r"\b(?:oczekiwan\w+|spodziewan\w+|docelow\w+)\s+(?:zysk|zwrot|stop\w+\s+zwrotu|wzrost)\w*"), 0.8),
        (_p(r"\b(?:osiągniemy|osiągniesz|zarobisz|wzrośnie|wzrosną)\b"), 0.65),
        (_p(r"\bpotencjał\w*\s+wzrostu|\bcel\w*\s+cenow\w*"), 0.7),
    ],
    "forecast_disclaimer": [
        (_p(r"prognoz\w*[^.\n]{0,80}nie\s+(?:są|stanowią|jest|stanowi)[^.\n]{0,40}"
            r"(?:wiarygodn|gwarancj|wskaźnik)\w*"), 0.95),
        (_p(r"nie\s+(?:stanowi|stanowią|jest|są)\s+wiarygodn\w+\s+wskaźnik\w*\s+przyszłych"), 0.9),
        (_p(r"stwierdze\w+\s+(?:dotycząc\w+\s+przyszłości|o\s+charakterze\s+prognoz)|forward[- ]looking\s+statements"), 0.9),
    ],
    "tax_reference": [
        (_p(r"zwoln\w+\s+(?:\w+\s+){0,3}z\s+(?:\d+[- ]?procentow\w+\s+)?podatk\w*|\bbez\s+podatku\b|\bulg\w+\s+podatkow\w*"
            r"|\bkorzyś\w+\s+podatkow\w*|\boptymalizacj\w+\s+podatkow\w*|\bodlicz\w+\s+(?:\w+\s+){0,3}od\s+(?:dochodu|podatku)"
            r"|\bpodatku\s+Belki\b|\bnie\s+płacisz\s+podatku"), 0.85),
        (_p(r"\bpodat\w*|\bIKZE\b|\bIKE\b|\bPIT\b"), 0.25),
    ],
    "tax_disclaimer": [
        (_p(r"(?:zależ\w+|uzależnion\w+)\s+od\s+(?:indywidualnej|osobistej)\s+sytuacji"), 0.95),
        (_p(r"(?:przepisy|zasady|traktowanie)\s+podatkow\w*[^.\n]{0,40}(?:mogą|może)\s+(?:ulec\s+)?zmian"), 0.9),
    ],
    "supervisor_mention": [
        (_p(r"\bKNF\b|\bKomisj\w+\s+Nadzoru\s+Finansowego|\bnadzor\w*\s+(?:finansow|KNF)\w*"), 0.95),
        (_p(r"\b(?:ESMA|CySEC|BaFin|FCA)\b|\bregulowan\w+\s+przez\b|\bpod\s+nadzorem\b"), 0.8),
    ],
    "supervisor_approval": [
        (_p(r"(?:zatwierdzon|zaaprobowan|rekomendowan|polecan|certyfikowan|zaakceptowan)\w*\s+przez\s+"
            r"(?:KNF|Komisj\w+\s+Nadzoru|nadzór|regulator)"), 0.95),
        (_p(r"\b(?:KNF|Komisja\s+Nadzoru\s+Finansowego)\s+(?:zatwierdzi|poleca|rekomenduje|gwarantuje"
            r"|potwierdzi)\w*"), 0.95),
        (_p(r"\bz\s+(?:aprobatą|akceptacją|rekomendacją)\s+(?:KNF|Komisji)"), 0.95),
    ],
    "supervisor_safety": [
        (_p(r"(?:bezpieczn|pewn|gwarant|chronion)\w*[^.\n]{0,80}(?:KNF|Komisj\w+\s+Nadzoru|nadzor\w*)"), 0.8),
        (_p(r"(?:KNF|Komisj\w+\s+Nadzoru|nadzor\w*)[^.\n]{0,80}(?:bezpieczn|pewn|gwarant|chroni)\w*"), 0.8),
    ],
    "comparison": [
        (_p(r"\blepsz\w+\s+niż|\bwyższ\w+\s+niż|\bniższ\w+\s+niż|\btańsz\w+\s+niż|\bw\s+porównaniu\s+(?:z|do)\b|\bw\s+zestawieniu\s+z\b"), 0.85),
        (_p(r"\bniż\s+(?:na\s+)?(?:lokat|bank|konkurencj)\w*"), 0.85),
    ],
    "comparison_source": [
        (_p(r"\bźródło\s*:|\bwedług\s+(?:danych|rankingu|raportu)|\bna\s+podstawie\s+(?:danych|rankingu|analizy)"
            r"|\bzałożeni\w*\s*:"), 0.85),
    ],
}  # fmt: skip

# Dopasowanie cechy nie liczy się, gdy w jego otoczeniu (±80 znaków) jest ten kontekst.
_EXCLUDE: dict[str, re.Pattern[str]] = {
    # „opłata 1% p.a.”, „zwolnienie z podatku od zysków” to nie obietnica zysku.
    "gain_claim": _p(r"opłat|prowizj|koszt\w*|\bVAT\b|marż|podat"),
    # „prospekt został zatwierdzony przez KNF” to wymagana informacja, nie sugerowanie aprobaty.
    "supervisor_approval": _p(r"prospekt|memorandum|dokument\w*\s+informacyjn|suplement|aneks"),
    # Lista słów w zastrzeżeniu („przewiduje”, „prognozuje”…) to nie prognoza.
    "forecast": _p(
        r"stwierdze\w+|wyraże\w+\s+takie\s+jak|słow\w+\s+takie\s+jak|zaprzeczeni|forward"
    ),
}
_EXCLUDE_WINDOW = 80

_PL_HINT = re.compile(r"[ąćęłńóśźż]|\b(?:się|jest|nie|oraz|lub|że|dla|może|są)\b", _F)
_EN_HINT = re.compile(r"\b(?:the|and|of|your|is|are|may|you|with|not|to)\b", _F)


@dataclass(frozen=True)
class Hit:
    score: float
    paragraph: int
    start: int  # pozycja dopasowania w akapicie
    end: int


@dataclass
class Paragraph:
    text: str
    features: dict[str, Hit | None] = field(default_factory=dict)


@dataclass(frozen=True)
class Finding:
    rule_id: str
    result: Result
    confidence: float
    quote: str | None
    reason: str
    # Silnik LLM: P(violation), P(ok), P(n/a) z logprobs odpowiedzi modelu.
    probabilities: dict[Result, float] | None = None


@dataclass(frozen=True)
class RiskAnalysis:
    findings: list[Finding]
    summary: str


def split_paragraphs(text: str) -> list[str]:
    return [line.strip() for line in text.split("\n") if line.strip()]


def _score_paragraph(index: int, text: str) -> Paragraph:
    paragraph = Paragraph(text=text)
    for name, patterns in _FEATURES.items():
        best: Hit | None = None
        exclude = _EXCLUDE.get(name)
        for pattern, weight in patterns:
            if best is not None and weight <= best.score:
                continue
            for match in pattern.finditer(text):
                window = text[
                    max(0, match.start() - _EXCLUDE_WINDOW) : match.end() + _EXCLUDE_WINDOW
                ]
                if exclude is None or not exclude.search(window):
                    best = Hit(weight, index, match.start(), match.end())
                    break
        paragraph.features[name] = best
    return paragraph


def _best(paragraphs: list[Paragraph], feature: str) -> Hit | None:
    hits = [h for p in paragraphs if (h := p.features[feature]) is not None]
    return max(hits, key=lambda h: h.score, default=None)


def _score(hit: Hit | None) -> float:
    return hit.score if hit else 0.0


def _quote(paragraphs: list[Paragraph], hit: Hit | None) -> str | None:
    """Dosłowny fragment akapitu (≤ 300 znaków) wokół dopasowania."""
    if hit is None:
        return None
    text = paragraphs[hit.paragraph].text
    if len(text) <= QUOTE_MAX:
        return text
    start = max(0, min(hit.start - 80, len(text) - QUOTE_MAX))
    # Początek na granicy słowa, żeby cytat nie zaczynał się od połowy wyrazu.
    if start > 0:
        space = text.find(" ", start)
        if 0 <= space < hit.start:
            start = space + 1
    snippet = text[start : start + QUOTE_MAX]
    if start + QUOTE_MAX < len(text) and " " in snippet:
        snippet = snippet[: snippet.rfind(" ")]
    return snippet.strip()


def _language(text: str) -> Literal["pl", "en"] | None:
    pl = len(_PL_HINT.findall(text))
    en = len(_EN_HINT.findall(text))
    if pl == en == 0:
        return None
    return "pl" if pl >= en else "en"


def _decide(
    rule_id: str,
    applicable: float,
    violation: float,
    quote: str | None,
    reasons: tuple[str, str, str],
) -> Finding:
    """reasons = (naruszenie, ok, nie dotyczy)."""
    if applicable < APPLICABLE_MIN:
        return Finding(rule_id, "n/a", round(1 - applicable, 2), None, reasons[2])
    if violation >= VIOLATION_MIN and quote:
        return Finding(rule_id, "violation", round(violation, 2), quote, reasons[0])
    return Finding(rule_id, "ok", round(1 - violation, 2), quote, reasons[1])


def _proximity_coverage(paragraphs: list[Paragraph], index: int) -> float:
    """Na ile ostrzeżenie o ryzyku „bezpośrednio towarzyszy” akapitowi `index` (reguła 3).

    Ten sam akapit liczy się w pełni, sąsiedni prawie w pełni, dalsze coraz mniej — ostrzeżenie
    tylko w stopce nie pokrywa obietnicy z nagłówka.
    """
    decay = (1.0, 0.85, 0.5)
    coverage = 0.0
    for j, paragraph in enumerate(paragraphs):
        hit = paragraph.features["risk_warning"]
        if hit is None:
            continue
        distance = abs(index - j)
        factor = decay[distance] if distance < len(decay) else 0.15
        coverage = max(coverage, hit.score * factor)
    return coverage


def analyze_risk_disclosure(text: str, rules: list[str] | None = None) -> RiskAnalysis:
    paragraphs = [_score_paragraph(i, t) for i, t in enumerate(split_paragraphs(text))]
    requested = [r for r in RULE_IDS if rules is None or r in rules]
    headline = _quote(paragraphs, Hit(1.0, 0, 0, 0)) if paragraphs else None

    def best(name: str) -> Hit | None:
        return _best(paragraphs, name)

    findings: list[Finding] = []
    for rule_id in requested:
        if rule_id in _NOT_EVALUATED:
            findings.append(Finding(rule_id, "n/a", 0.0, None, _NOT_EVALUATED[rule_id]))
            continue
        findings.append(_evaluate(rule_id, paragraphs, best, headline, text))

    return RiskAnalysis(findings=findings, summary=summarize(findings))


def _evaluate(
    rule_id: str,
    paragraphs: list[Paragraph],
    best: Callable[[str], Hit | None],
    headline: str | None,
    text: str,
) -> Finding:
    match rule_id:
        case "1":
            firm = best("firm_name")
            return _decide(
                "1", 1.0, 1 - _score(firm), _quote(paragraphs, firm) if firm else headline,
                ("Nie znaleziono oficjalnej nazwy firmy inwestycyjnej (forma prawna, „Dom Maklerski”).",
                 "Materiał zawiera nazwę firmy z formą prawną.",
                 ""),
            )  # fmt: skip
        case "2":
            label = best("ad_label")
            return _decide(
                "2", 1.0, 1 - _score(label), _quote(paragraphs, label) if label else headline,
                ("Materiał nie jest oznaczony jako reklama ani materiał marketingowy.",
                 "Materiał jest oznaczony jako reklama / materiał marketingowy.",
                 ""),
            )  # fmt: skip
        case "3":
            gain = best("gain_claim")
            worst_p, worst_hit = 0.0, gain
            for paragraph in paragraphs:
                hit = paragraph.features["gain_claim"]
                if hit is None:
                    continue
                p = hit.score * (1 - _proximity_coverage(paragraphs, hit.paragraph))
                if p > worst_p:
                    worst_p, worst_hit = p, hit
            return _decide(
                "3", _score(gain), worst_p, _quote(paragraphs, worst_hit),
                ("Informacji o zysku nie towarzyszy bezpośrednio informacja o istotnym ryzyku.",
                 "Przy informacji o zysku jest ostrzeżenie o ryzyku.",
                 "Materiał nie zawiera twierdzeń o zyskach."),
            )  # fmt: skip
        case "10":
            warning = best("risk_warning")
            main_lang = _language(text)
            warn_lang = _language(paragraphs[warning.paragraph].text) if warning else None
            mismatch = main_lang is not None and warn_lang is not None and main_lang != warn_lang
            return _decide(
                "10", _score(warning), 0.85 if mismatch else 0.05, _quote(paragraphs, warning),
                (f"Ostrzeżenie o ryzyku jest w innym języku ({warn_lang}) niż materiał ({main_lang}).",
                 "Ostrzeżenie o ryzyku jest w języku materiału.",
                 "Brak ostrzeżenia o ryzyku do porównania języka."),
            )  # fmt: skip
        case "11":
            comparison = best("comparison")
            source = max(
                (
                    _score(p.features["comparison_source"])
                    for p in paragraphs[
                        max(0, comparison.paragraph - 1) : comparison.paragraph + 2
                    ]
                ),
                default=0.0,
            ) if comparison else 0.0  # fmt: skip
            return _decide(
                "11", _score(comparison), _score(comparison) * (1 - source),
                _quote(paragraphs, comparison),
                ("Porównanie produktów/usług bez wskazania źródła i założeń.",
                 "Porównanie ze wskazanym źródłem.",
                 "Materiał nie zawiera porównań produktów lub usług."),
            )  # fmt: skip
        case "12a" | "12b" | "14":
            hist = best("historical_results")
            other, violation_reason, ok_reason = {
                "12a": ("hist_period_source",
                        "Wyniki historyczne bez wskazania okresu referencyjnego (5 lat, pełne 12 mies.) i źródła.",
                        "Przy wynikach historycznych wskazano okres i źródło."),
                "12b": ("currency_fees",
                        "Wyniki historyczne bez ostrzeżenia o wpływie kursów walut i opłat/prowizji.",
                        "Przy wynikach historycznych opisano wpływ walut lub opłat."),
                "14": ("hist_disclaimer",
                       "Wyniki historyczne bez zastrzeżenia, że nie są wiarygodnym wskaźnikiem przyszłych wyników.",
                       "Jest zastrzeżenie, że wyniki historyczne nie gwarantują przyszłych."),
            }[rule_id]  # fmt: skip
            return _decide(
                rule_id,
                _score(hist),
                _score(hist) * (1 - _score(best(other))),
                _quote(paragraphs, hist),
                (violation_reason, ok_reason, "Materiał nie prezentuje wyników historycznych."),
            )
        case "15":
            forecast = best("forecast")
            return _decide(
                "15", _score(forecast),
                _score(forecast) * (1 - _score(best("forecast_disclaimer"))),
                _quote(paragraphs, forecast),
                ("Prognoza przyszłych wyników bez ostrzeżenia, że nie jest wiarygodnym wskaźnikiem.",
                 "Wykryto prognozę; towarzyszy jej wymagane ostrzeżenie.",
                 "Materiał nie zawiera prognoz."),
            )  # fmt: skip
        case "16":
            tax = best("tax_reference")
            return _decide(
                "16", _score(tax), _score(tax) * (1 - _score(best("tax_disclaimer"))),
                _quote(paragraphs, tax),
                ("Odwołanie do podatków bez informacji o zależności od sytuacji klienta i możliwych zmianach.",
                 "Przy informacji podatkowej jest wymagane zastrzeżenie.",
                 "Materiał nie odwołuje się do traktowania podatkowego."),
            )  # fmt: skip
        case "17" | "18":
            mention = best("supervisor_mention")
            feature = "supervisor_approval" if rule_id == "17" else "supervisor_safety"
            hit = best(feature)
            return _decide(
                rule_id, _score(mention), _score(hit), _quote(paragraphs, hit or mention),
                ("Odwołanie do organu nadzoru sugeruje zatwierdzenie produktu lub usługi."
                 if rule_id == "17" else
                 "Nadzór KNF użyty jako argument bezpieczeństwa inwestycji.",
                 "Wzmianka o nadzorze ma charakter informacyjny.",
                 "Materiał nie odwołuje się do organu nadzoru."),
            )  # fmt: skip
        case _:
            raise ValueError(f"Nieobsługiwana reguła: {rule_id}")


def summarize(findings: list[Finding]) -> str:
    violations = [f for f in findings if f.result == "violation"]
    if not violations:
        return "Nie wykryto naruszeń w regułach ocenianych z tekstu."
    ids = ", ".join(f.rule_id for f in violations)
    top = max(violations, key=lambda f: RULE_WEIGHTS.get(f.rule_id, 0.5) * f.confidence)
    return f"Możliwe naruszenia reguł: {ids}. Najpoważniejsze: {top.reason}"


def p_violation(finding: Finding) -> float:
    """Prawdopodobieństwo naruszenia reguły, niezależnie od tego, która odpowiedź wygrała.

    LLM: P(TAK) z logprobs. Regex: przy `violation` to `confidence`, przy `ok` to 1 - confidence,
    przy `n/a` zero. Dzięki temu „TAK 45%, NIE 50%” nie zeruje się, tylko daje 0,45.
    """
    if finding.probabilities is not None:
        return finding.probabilities["violation"]
    if finding.result == "violation":
        return finding.confidence
    if finding.result == "ok":
        return 1 - finding.confidence
    return 0.0


@dataclass(frozen=True)
class RuleScore:
    p_violation: float  # P(naruszenie) reguły
    weight: float  # powaga reguły (RULE_WEIGHTS)
    score: float  # weight * p_violation — wkład reguły do risk score


def rule_scores(findings: list[Finding]) -> dict[str, RuleScore]:
    """Score każdej reguły, klucz = id reguły."""
    scores: dict[str, RuleScore] = {}
    for finding in findings:
        p = p_violation(finding)
        weight = RULE_WEIGHTS.get(finding.rule_id, 0.5)
        scores[finding.rule_id] = RuleScore(round(p, 3), weight, round(weight * p, 3))
    return scores


# Każde kolejne naruszenie (od najpoważniejszego) liczy się z wagą mniejszą o ten czynnik.
RISK_DECAY = 0.5


def max_rule_score(findings: list[Finding]) -> float:
    """Najwyższy score reguły — do progu (suwaka kalibracji).

    Próg porównujemy ze score'em każdej reguły osobno: materiał jest incydentem przy progu t,
    gdy któraś reguła ma score >= t, czyli dokładnie wtedy, gdy max_rule_score >= t.
    """
    return max((s.score for s in rule_scores(findings).values()), default=0.0)


def risk_score(findings: list[Finding]) -> float:
    """Score materiału 0-1 z wszystkich reguł — DO SORTOWANIA listy zadań, nie do progu.

    Noisy-OR z zanikiem.

    Score'y reguł (waga * P(naruszenie)) sortujemy malejąco: s1 >= s2 >= ...
    risk = 1 - (1 - s1) * (1 - s2 * 0,5) * (1 - s3 * 0,25) * ...
    Najpoważniejsze naruszenie liczy się w pełni, każde kolejne coraz słabiej: kilka naruszeń
    podnosi score, ale nie tak jak zwykły noisy-OR, który zakłada niezależność reguł (a 12a, 12b
    i 14 zależą od tych samych wyników historycznych). W ewaluacji na 47 stronach wypadł jak
    maksimum przy progach 0,5 i 0,7 i minimalnie lepiej w rankingu (AP).
    """
    scores = sorted((s.score for s in rule_scores(findings).values()), reverse=True)
    remaining = 1.0
    for rank, score in enumerate(scores):
        remaining *= 1 - score * RISK_DECAY**rank
    return round(1 - remaining, 3)
