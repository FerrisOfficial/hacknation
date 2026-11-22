# ruff: noqa: E501, RUF001 — tabela wzorców regex i przykłady czytają się lepiej w jednej linii
"""Moduł 3: usługi nieautoryzowane (shadow advisory), docs/materialy-uknf/doradztwo-inwestycyjne.md.

Doradztwo inwestycyjne (art. 76 ustawy o obrocie instrumentami finansowymi) to rekomendacja
dotycząca instrumentów finansowych, przygotowana w oparciu o potrzeby i sytuację klienta. Szukamy
w tekście przesłanek, że ktoś oferuje taką usługę:

1. tekst → akapity, w każdym akapicie score przesłanki (oferta usługi, rekomendacje dotyczące
   instrumentów, dopasowanie do klienta, odpłatność, powoływanie się na uprawnienia, zastrzeżenie
   „to nie jest doradztwo” przy ofercie indywidualnej) z fraz regex,
2. P(doradztwo) = jawny warunek z art. 76: oferta usługi I (rekomendacje instrumentów LUB
   dopasowanie do klienta), czyli min(oferta, max(rekomendacje, dopasowanie)). Sama wzmianka
   o akcjach albo o zarządzaniu majątkiem nie wystarcza. Pozostałe przesłanki (odpłatność,
   uprawnienia, zastrzeżenie) to osobne reguły z cytatem — podnoszą risk score (noisy-OR jak w M2),
3. w wariancie `hybrid` werdykt wydaje LLM (Bielik, P(TAK) z logprobs) na dwa pytania: czy autor
   oferuje doradztwo inwestycyjne (art. 69 ust. 2 pkt 5) i czy oferuje zarządzanie portfelem (pkt 4);
   P = max z obu, regex zostaje bramką (LLM tylko przy przesłankach) i źródłem cytatów,
4. każda przesłanka to osobna reguła z dosłownym cytatem — analityk widzi, dlaczego oflagowano.

Czy podmiot ma zezwolenie, rozstrzyga backend z rejestru KNF (tu nie ma dostępu do sieci).
Moduł zwraca też dane podmiotu z treści (nazwa, NIP/KRS/REGON, e-mail, telefon) do raportu.
"""

import logging
import os
import re
from dataclasses import dataclass, field

import httpx

from ml import knf, risk_llm
from ml.risk import QUOTE_MAX, Finding, Result, RuleScore, p_violation, split_paragraphs

log = logging.getLogger(__name__)

# Reguła zbiorcza: werdykt modułu (kontrakt §1: `rules = ["M3.advisory"]`) i przesłanki.
ADVISORY_RULE = "M3.advisory"
SIGNAL_RULES: dict[str, str] = {
    "offer": "M3.offer",
    "recommendation": "M3.recommendation",
    "personal": "M3.personal",
    "paid": "M3.paid",
    "claims": "M3.claims",
    "disclaimer": "M3.disclaimer",
}
RULE_IDS: tuple[str, ...] = (ADVISORY_RULE, *SIGNAL_RULES.values())

POSITIVE_LABEL = "potencjalne_doradztwo"
NEGATIVE_LABEL = "brak_przeslanek"
VIOLATION_MIN = 0.5
SIGNAL_MIN = 0.3  # poniżej tej wartości przesłanki nie pokazujemy jako naruszenia

_F = re.IGNORECASE | re.UNICODE
_OPT = r"(?:\w+\s+){0,2}"  # do dwóch dowolnych słów pomiędzy


def _p(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, _F)


# Przesłanka → lista (wzorzec, waga). Waga = pewność, że dopasowanie oznacza przesłankę.
_SIGNALS: dict[str, list[tuple[re.Pattern[str], float]]] = {
    "offer": [
        (_p(r"\bdoradztw\w*\s+(?:inwestycyjn|majątkow|kapitałow|giełdow)\w*"), 0.9),
        (
            _p(
                r"\b(?:usług\w*|ofert\w*|oferujemy|świadczymy|zapewniamy)\s+"
                + _OPT
                + r"dorad\w*\s+(?:\w+\s+){0,2}(?:inwestycyjn|majątkow|finansow|kapitałow)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\bwealth\s+management\b|\bfamily\s+office\b|\bprivate\s+wealth\b|\binvestment\s+(?:consulting|advisory|advice)\b"
            ),
            0.9,
        ),
        (
            _p(
                r"\bzarządza(?:my|m)\s+"
                + _OPT
                + r"(?:majątki?\w*|portfel\w*|kapitał\w*|aktyw\w*|oszczędności\w*|inwestycj\w*\s+klient\w*)"
            ),
            0.85,
        ),
        (
            _p(
                r"(?:otrzym|dostaw|wysył|codzienn|grup|kanał|telegram|discord|subskryp|abonament)\w*[^.\n]{0,40}\b(?:sygnał\w*|alert\w*\s+(?:transakcyjn|inwestycyjn|kupna|sprzedaży))|\bsygnał\w*[^.\n]{0,40}(?:vip|premium|telegram|discord|grup\w*|subskryp\w*)|\b(?:vip|premium)\s+(?:sygnał\w*|signals?)\b|\btrading\s+signals?\b"
            ),
            0.85,
        ),
        (
            _p(r"\bsygnał\w*\s+(?:transakcyjn|inwestycyjn|tradingow|kupna|sprzedaży|giełdow)\w*"),
            0.4,
        ),
        (
            _p(
                r"\bzainwestujemy\s+(?:twoje|pana|pani|państwa|wasze)\b|\bpomnożymy\s+(?:twój|twoje|pana|pani|państwa)\b"
            ),
            0.9,
        ),
        (
            _p(
                r"\bpomoż\w+\s+(?:ci|państwu|wam|panu|pani)\s+(?:\w+\s+){0,3}(?:zainwestować|inwestować|ulokować|pomnożyć|zbudować\s+portfel)"
            ),
            0.8,
        ),
        (
            _p(
                r"\b(?:konsultacj|porad|sesj)\w*\s+"
                + _OPT
                + r"(?:inwestycyjn|giełdow|tradingow)\w*"
            ),
            0.75,
        ),
        (
            _p(
                r"\bmentoring\w*\s+"
                + _OPT
                + r"(?:inwestycyjn|giełdow|tradingow|finansow)\w*|\bmentor\w*\s+(?:inwestycyjn|tradingow|giełdow)\w*"
            ),
            0.7,
        ),
        (
            _p(
                r"\bdorad(?:ztw\w*|c\w+)\s+finansow\w*|\bfinancial\s+advis\w*|\bplanowani\w*\s+finansow\w*"
            ),
            0.55,
        ),
        (_p(r"\bkopiowani\w*\s+(?:moich\s+|naszych\s+)?transakcji\b|\bcopy\s?trading\b"), 0.45),
        (
            _p(
                r"\bzarządza\w*\s+(?:twoi|twoj|pana|pani|państwa|waszy|klient)\w*\s+(?:\w+\s+)?(?:majątki?\w*|portfel\w*|kapitał\w*|aktyw\w*|oszczędności\w*)"
            ),
            0.85,
        ),
        (
            _p(
                r"\bzarządzani\w*\s+(?:majątki?\w*|portfel\w*|aktyw\w*|kapitał\w*)|\basset\s+management\b"
            ),
            0.5,
        ),
    ],
    "recommendation": [
        (
            _p(
                r"\brekomendacj\w*\s+"
                + _OPT
                + r"(?:kupna|sprzedaży|kup|sprzedaj|trzymaj|inwestycyjn|giełdow|akcji|spółek|instrument)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\b(?:wskazujemy|wskażemy|podpowiemy|powiemy|doradzimy|podpowiadamy|doradzamy)\b[^.\n]{0,60}(?:kupić|sprzedać|inwestować|zainwestować|akcj|spółk|instrument|fundusz|etf|obligacj)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\b(?:kupuj|kup|sprzedaj|sprzedawaj|trzymaj|akumuluj)\b\s+(?:\w+\s+){0,3}(?:akcj|obligacj|etf|fundusz|kontrakt|opcj|spółk|walut|bitcoin|krypto)\w*"
            ),
            0.6,
        ),
        (
            _p(
                r"\bskład\w*\s+portfel\w*|\bportfel\w*\s+(?:modelow|rekomendowan|wzorcow)\w*|\bgotow\w+\s+portfel\w*"
            ),
            0.75,
        ),
        (
            _p(
                r"\b(?:jakie|które|w\s+jakie|w\s+co)\s+(?:\w+\s+){0,2}(?:kupić|sprzedać|zainwestować|inwestować)\b"
            ),
            0.65,
        ),
        (
            _p(
                r"\b(?:cen\w*|kurs\w*)\s+docelow\w*|\bwejści\w*\s+w\s+pozycj\w*|\bstop\s?loss\w*[^.\n]{0,40}take\s?profit"
            ),
            0.6,
        ),
        (
            _p(
                r"\b(?:akcj|obligacj|etf|fundusz\w*\s+inwestycyjn|kontrakt\w*\s+terminow|opcj\w*\s+(?:na|binarn)|cfd|forex)\w*"
            ),
            0.25,
        ),
    ],
    "personal": [
        (
            _p(
                r"\b(?:na\s+podstawie|w\s+oparciu\s+o|uwzględniając|z\s+uwzględnieniem)\s+"
                + _OPT
                + r"(?:twoj|twoi|twoic|pana|pani|państwa|indywidualn|klient)\w*\s+"
                + _OPT
                + r"(?:sytuacj|potrzeb|cel|profil|horyzont|budżet|apetyt|możliwości)\w*"
            ),
            0.9,
        ),
        (
            _p(
                r"\bindywidualn\w*\s+"
                + _OPT
                + r"(?:strategi|portfel|plan|rekomendacj|porad|konsultacj|doradztw|podejści|analiz|ofert|rozwiązani)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\bdopasowan\w*\s+(?:\w+\s+){0,3}(?:twoi|twoj|twoic|pana|pani|państwa|indywidualn|potrzeb|cel|sytuacj|profil|klient)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\banaliz\w*\s+"
                + _OPT
                + r"(?:twojego|twoich|twojej|pana|pani|państwa)\s+(?:\w+\s+)?(?:portfel|sytuacj|inwestycj|finans|majątk|oszczędnoś)\w*"
            ),
            0.85,
        ),
        (
            _p(
                r"\b(?:s?personalizowan\w*|szyt\w+\s+na\s+miarę)\s+(?:\w+\s+)?(?:strategi|portfel|rekomendacj|porad|doradztw|plan|ofert|inwestycj)\w*|\b(?:personali[sz]ed|tailor(?:ed|-made))\s+(?:investment|advice|portfolio|strateg|financial|wealth)\w*"
            ),
            0.8,
        ),
        (
            _p(
                r"\b(?:konsultacj|spotkani|rozmow|sesj)\w*\s+(?:\w+\s+)?(?:1\s?(?::|na|-)\s?1|jeden\s+na\s+jeden)\b|\b1\s?(?::|na)\s?1\b"
            ),
            0.8,
        ),
        (
            _p(
                r"\bprofil\w*\s+(?:ryzyka|inwestycyjn|inwestora)\w*|\bapetyt\w*\s+na\s+ryzyko|\bhoryzont\w*\s+inwestycyjn\w*"
            ),
            0.5,
        ),
    ],
    "paid": [
        (
            _p(
                r"\bsuccess\s+fee\b|\bprowizj\w*\s+od\s+(?:zysk|wypracowan)\w*|\bwynagrodzeni\w*\s+(?:\w+\s+)?od\s+(?:zysk|wynik)\w*|\bopłat\w*\s+za\s+(?:zarządzanie|wynik|sukces)\w*"
            ),
            0.9,
        ),
        (
            _p(
                r"(?:\b(?:cen\w*|koszt\w*|opłat\w*|abonament\w*|płacisz|tylko|już\s+od)\s*:?\s*\d+(?:[  ]\d{3})*(?:[.,]\d+)?\s?(?:zł|pln)\b)|\d+(?:[  ]\d{3})*(?:[.,]\d+)?\s?(?:zł|pln)\s*(?:/|za)\s*(?:mc|mies\w*|miesiąc|rok|h\b|godz\w*|konsultacj\w*|sesj\w*|spotkani\w*)"
            ),
            0.8,
        ),
        (
            _p(
                r"\b(?:umów|zarezerwuj|umówić|zamów|zapisz\s+się\s+na|zarezerwować)\s+"
                + _OPT
                + r"(?:konsultacj|spotkani|rozmow|sesj|termin|analiz)\w*"
            ),
            0.75,
        ),
        (
            _p(
                r"\b(?:bezpłatn|darmow)\w*\s+(?:\w+\s+)?(?:konsultacj|spotkani|rozmow|analiz|audyt)\w*"
            ),
            0.75,
        ),
        (
            _p(
                r"\b(?:abonament|subskrypcj|członkostw|pakiet|dostęp)\w*\s+"
                + _OPT
                + r"(?:premium|vip|miesięczn|roczn)\w*"
            ),
            0.7,
        ),
        (
            _p(
                r"\bdołącz\w*\s+do\s+"
                + _OPT
                + r"(?:grupy|klubu|społeczności|kanału)\s+(?:\w+\s+)?(?:vip|premium|płatn\w*|zamkni\w*)"
            ),
            0.8,
        ),
    ],
    "claims": [
        (
            _p(
                r"\b(?:licencjonowan|certyfikowan|autoryzowan|uprawnion|regulowan)\w*\s+(?:\w+\s+)?(?:dorad|zarządzając|ekspert|specjalist|analityk|podmiot|firm)\w*"
            ),
            0.8,
        ),
        (
            _p(
                r"\b(?:licencj\w*|zezwoleni\w*|nadzor\w*)\s+"
                + _OPT
                + r"(?:knf|komisji\s+nadzoru\s+finansowego|fca|cysec)\b"
            ),
            0.75,
        ),
        (_p(r"\bdorad\w*\s+inwestycyjn\w*\s+(?:z\s+)?(?:licencj|nr|numer|wpisan)\w*"), 0.85),
        (_p(r"\b(?:CFA|EFA|EFP|EFPA|CFP|EIP)\b"), 0.55),
    ],
    "disclaimer": [
        (
            _p(
                r"\bnie\s+(?:stanowi|jest|są|stanowią)\s+(?:\w+\s+){0,3}(?:doradztw|porad\w*\s+inwestycyjn|rekomendacj)\w*"
            ),
            0.9,
        ),
        (_p(r"\bnot\s+(?:financial|investment)\s+advice\b"), 0.9),
        (
            _p(
                r"\b(?:wyłącznie|tylko|jedynie)\s+(?:w\s+)?(?:cel\w*\s+)?(?:edukacyjn|informacyjn|szkoleniow)\w*"
            ),
            0.7,
        ),
    ],
}

# Kontekst, w którym dopasowanie nie świadczy o doradztwie inwestycyjnym (kredyty, ubezpieczenia).
_EXCLUDE: dict[str, re.Pattern[str]] = {
    "offer": _p(
        r"kredyt\w*|hipote\w*|ubezpiecz\w*|leasing\w*|pożycz\w*|podatkow\w*|nieruchomoś\w*|księgow\w*|zasięgn\w*|skonsult\w*|należy|zaleca\w*|rozporządzeni\w*|dz\.\s?u\.|w\s+rozumieniu|w\s+sprawie\s+informacji|ustaw\w*\s+o\s+obrocie"
    ),
    "recommendation": _p(
        r"rozporządzeni\w*|dz\.\s?u\.|w\s+rozumieniu|w\s+sprawie\s+informacji|ustaw\w*\s+o\s+obrocie"
    ),
    "personal": _p(
        r"kredyt\w*|hipote\w*|ubezpiecz\w*|leasing\w*|pożycz\w*|dieta|trening|fitness|bank\w*|kont\w*\s+osobist\w*|kart\w*|branż\w*|rozporządzeni\w*|dz\.\s?u\.|w\s+rozumieniu|w\s+sprawie\s+informacji|ustaw\w*\s+o\s+obrocie"
    ),
    "claims": _p(r"skonsult\w*|zasięgn\w*|należy|zwróć\s+się"),
}
_EXCLUDE_WINDOW = 60

# Zaprzeczenie w tym samym zdaniu przed dopasowaniem: „nie stanowi doradztwa inwestycyjnego ani
# rekomendacji kupna”, „nie udzielam indywidualnych porad”. Zastrzeżenia nie są ofertą.
_NEGATION = _p(
    r"\bnie\s+(?:\w+\s+){0,2}?(?:stanowi|jest|są|oferuj|świadcz|udziel|prowadz|posiad|mo[gż]|należy|zawiera|traktowa|był|będ)\w*|\bnie\s+(?:\w+\s+)?(?:indywidualn|osobist|spersonalizowan)\w*|\bani\b|\bżadn\w+|\bbez\s+(?:uprawnień|licencji|zezwolenia)|\b(?:does|do|will|is|are)\s+not\b|\b(?:don|doesn|won|isn|aren)['’]t\b|\bnor\b|\bno\b"
)
_NEGATION_WINDOW = 150
_SENTENCE_END = re.compile(r"[.!?;](?=\s|$)")


QUESTION_FACTOR = 0.5


def _question(paragraph: str, end: int) -> bool:
    rest = paragraph[end:]
    stop = _SENTENCE_END.search(rest + " ")
    return (stop.group(0) if stop else "") == "?" or (stop is None and rest.rstrip().endswith("?"))


def _negated(paragraph: str, start: int) -> bool:
    prefix = paragraph[max(0, start - _NEGATION_WINDOW) : start]
    ends = list(_SENTENCE_END.finditer(prefix))
    if ends:
        prefix = prefix[ends[-1].end() :]
    return bool(_NEGATION.search(prefix))


SIGNAL_NAMES: dict[str, str] = {
    "offer": "oferta doradztwa lub zarządzania majątkiem",
    "recommendation": "rekomendacje dotyczące instrumentów finansowych",
    "personal": "dopasowanie do sytuacji klienta",
    "paid": "odpłatna usługa i pozyskiwanie klientów",
    "claims": "powoływanie się na uprawnienia",
    "disclaimer": "zastrzeżenie „to nie jest doradztwo”",
}

_REASONS: dict[str, str] = {
    "offer": "Tekst oferuje usługę doradztwa inwestycyjnego, zarządzania majątkiem albo sygnały transakcyjne.",
    "recommendation": "Tekst zawiera albo zapowiada rekomendacje kupna, sprzedaży lub trzymania instrumentów finansowych.",
    "personal": "Rekomendacje mają być dopasowane do potrzeb i sytuacji klienta — to cecha doradztwa z art. 76 ustawy.",
    "paid": "Usługa jest odpłatna albo tekst zachęca do umówienia konsultacji.",
    "claims": "Tekst powołuje się na licencję, certyfikat lub nadzór — zweryfikuj w rejestrze KNF.",
    "disclaimer": "Zastrzeżenie „to nie jest doradztwo” stoi obok oferty indywidualnej — o charakterze usługi decyduje jej treść.",
}

# Warunek doradztwa (art. 76 u.o.o.i.f.): oferta usługi I (rekomendacje instrumentów LUB
# dopasowanie do klienta). „I” = min, „LUB” = max — bez wag, analityk widzi, które przesłanki
# zdecydowały. Finfluencer piszący „kupuję akcje X” nie ma oferty → P = 0, a strona wealth
# managera z ofertą „indywidualnej strategii” — już tak.
REQUIRED = "offer"
ANY_OF: tuple[str, ...] = ("recommendation", "personal")
# Waga reguły w jej score (jak `risk.RULE_WEIGHTS` w M2). Z tych score'ów backend liczy risk score.
RULE_WEIGHTS: dict[str, float] = {ADVISORY_RULE: 1.0, **dict.fromkeys(SIGNAL_RULES.values(), 1.0)}
# Usługi, o które pytamy LLM w wariancie `hybrid`. Kody z rejestru KNF („Zakres działalności”,
# art. 69 ust. 2 UoIF): 5 — doradztwo inwestycyjne, 4 — zarządzanie portfelem. Backend porównuje
# `service` z zakresem zezwolenia podmiotu.
SERVICES: dict[str, str] = {"advisory": "5", "portfolio": "4"}
SERVICE_NAMES: dict[str, str] = {
    "advisory": "doradztwo inwestycyjne",
    "portfolio": "zarządzanie portfelem",
}
# LLM pytamy tylko, gdy regex widzi choć trochę przesłanek — strona brokera bez oferty doradczej
# nie musi czekać na model.
LLM_GATE = 0.3  # bez oferty usługi nie ma doradztwa, więc model nie jest potrzebny


@dataclass(frozen=True)
class SignalHit:
    score: float
    quote: str | None


@dataclass(frozen=True)
class Subject:
    """Dane podmiotu z treści oferty (do raportu i wyszukania w rejestrze KNF)."""

    name: str | None
    identifiers: tuple[knf.Identifier, ...] = ()
    emails: tuple[str, ...] = ()
    phones: tuple[str, ...] = ()


@dataclass(frozen=True)
class AdvisoryAnalysis:
    probability: float  # P(doradztwo inwestycyjne)
    label: str
    findings: list[Finding]
    summary: str
    signals: dict[str, float]
    subject: Subject
    engine: str = "rules"
    llm: dict[str, float] = field(default_factory=dict)  # P(TAK) od LLM per usługa z SERVICES
    service: str | None = None  # usługa z najwyższym P od LLM (klucz SERVICES)


def _quote(paragraph: str, start: int) -> str:
    if len(paragraph) <= QUOTE_MAX:
        return paragraph
    begin = max(0, min(start - 80, len(paragraph) - QUOTE_MAX))
    if begin > 0:
        space = paragraph.find(" ", begin)
        if 0 <= space < start:
            begin = space + 1
    snippet = paragraph[begin : begin + QUOTE_MAX]
    if begin + QUOTE_MAX < len(paragraph) and " " in snippet:
        snippet = snippet[: snippet.rfind(" ")]
    return snippet.strip()


def _signal(paragraphs: list[str], name: str) -> SignalHit:
    best = SignalHit(0.0, None)
    exclude = _EXCLUDE.get(name)
    for paragraph in paragraphs:
        for pattern, weight in _SIGNALS[name]:
            if weight <= best.score:
                continue
            for match in pattern.finditer(paragraph):
                window = paragraph[
                    max(0, match.start() - _EXCLUDE_WINDOW) : match.end() + _EXCLUDE_WINDOW
                ]
                if exclude is not None and exclude.search(window):
                    continue
                if name != "disclaimer" and _negated(paragraph, match.start()):
                    continue
                score = weight * QUESTION_FACTOR if _question(paragraph, match.end()) else weight
                if score > best.score:
                    best = SignalHit(score, _quote(paragraph, match.start()))
                break
    return best


def probability(signals: dict[str, float]) -> float:
    return min(signals.get(REQUIRED, 0.0), max(signals.get(name, 0.0) for name in ANY_OF))


def rule_scores(findings: list[Finding]) -> dict[str, RuleScore]:
    """Score każdej reguły = waga * P(naruszenie), jak `risk.rule_scores` w M2."""
    scores: dict[str, RuleScore] = {}
    for finding in findings:
        weight = RULE_WEIGHTS.get(finding.rule_id)
        if weight is None:
            continue
        p = p_violation(finding)
        scores[finding.rule_id] = RuleScore(round(p, 3), weight, round(weight * p, 3))
    return scores


# ─── Dane podmiotu ──────────────────────────────────────────────────────────────────────────────

_LEGAL_FORM = r"(?:sp\.\s?z\s?o\.\s?o\.|spółka\s+z\s+ograniczoną\s+odpowiedzialnością|S\.\s?A\.|spółka\s+akcyjna|sp\.\s?k\.|sp\.\s?j\.|sp\.\s?k\.\s?a\.|P\.\s?S\.\s?A\.|Ltd\.?|Limited|LLC|GmbH|AG|OÜ|s\.\s?r\.\s?o\.)"
_COMPANY_RE = re.compile(
    r"((?:[A-ZĄĆĘŁŃÓŚŹŻ0-9][\w&.'’-]*\s+){1,5}?)" + _LEGAL_FORM + r"(?![\w])",
    re.UNICODE,
)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,24}\b", _F)
_PHONE_RE = re.compile(
    r"(?<![\d])(?:\+48[\s-]?)?(?:\d{3}[\s-]\d{3}[\s-]\d{3}|\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2})(?![\d])"
)
_NAME_STOP = frozenset({"w", "i", "oraz", "przez", "z", "na", "do", "od", "the", "and", "of"})


# Stanowisko albo opis przed nazwą firmy („Dyrektorem Finansowym Mennicy Polskiej S.A.”,
# „Partner w Kowalski sp. z o.o.”) — te słowa nie należą do nazwy, a cała wzmianka to zwykle
# biogram autora, nie podmiot oferty.
_ROLE_RE = re.compile(
    r"^(?:dyrektor|prezes|wiceprezes|członk|założyciel|współzałożyciel|partner|pracow|analityk|"
    r"zarząd|doradc|ekspert|szef|kierown|menedżer|manager|ceo|cfo|cio|head|był|jest|obecnie|"
    r"wcześniej|finansow|inwestycyjn|spółk|firm|grup|klient)",
    re.IGNORECASE,
)
# Dane firmy stoją zwykle w stopce strony albo na końcu opisu filmu.
_FOOTER_SHARE = 0.35


def extract_subject(text: str) -> Subject:
    scores: dict[str, float] = {}
    footer_from = len(text) * (1 - _FOOTER_SHARE)
    for match in _COMPANY_RE.finditer(text):
        words = match.group(1).split()
        role = False
        # Nazwa zaczyna się od słowa z wielkiej litery, bez spójników i stanowisk na początku.
        while words and (
            words[0].lower() in _NAME_STOP or not words[0][:1].isupper() or _ROLE_RE.match(words[0])
        ):
            role = role or bool(_ROLE_RE.match(words[0]))
            words.pop(0)
        if not words:
            continue
        name = f"{' '.join(words)} {match.group(0)[len(match.group(1)) :].strip()}"
        name = re.sub(r"\s+", " ", name).strip()
        # Wzmianka w biogramie waży mniej niż nazwa w stopce albo powtórzona.
        weight = (0.3 if role else 1.0) + (1.0 if match.start() >= footer_from else 0.0)
        scores[name] = scores.get(name, 0.0) + weight
    name = max(scores, key=scores.__getitem__) if scores and max(scores.values()) >= 1 else None
    emails = tuple(dict.fromkeys(m.group(0).lower() for m in _EMAIL_RE.finditer(text)))[:3]
    phones = tuple(
        dict.fromkeys(re.sub(r"[\s-]", " ", m.group(0)) for m in _PHONE_RE.finditer(text))
    )[:3]
    identifiers = tuple(dict.fromkeys(knf.extract_identifiers(text)))[:5]
    return Subject(
        name=name[:200] if name else None, identifiers=identifiers, emails=emails, phones=phones
    )


# ─── Analiza ────────────────────────────────────────────────────────────────────────────────────


def _findings(
    probability_: float,
    hits: dict[str, SignalHit],
    signals: dict[str, float],
    requested: set[str],
    llm: dict[str, float] | None = None,
) -> list[Finding]:
    findings: list[Finding] = []
    contradictory = (
        signals["disclaimer"] > 0 and max(signals["offer"], signals["personal"]) >= VIOLATION_MIN
    )
    for name, rule_id in SIGNAL_RULES.items():
        if rule_id not in requested:
            continue
        score = signals[name]
        hit = hits[name]
        present = score >= SIGNAL_MIN and (name != "disclaimer" or contradictory)
        result: Result = "violation" if present else "n/a"
        findings.append(
            Finding(
                rule_id,
                result,
                round(score if present else 1 - score, 3),
                hit.quote if present else None,
                _REASONS[name] if present else f"Brak przesłanki: {SIGNAL_NAMES[name]}.",
            )
        )
    if ADVISORY_RULE in requested:
        present_names = [n for n in SIGNAL_RULES if signals[n] >= SIGNAL_MIN and n != "disclaimer"]
        # Cytat werdyktu z przesłanek warunku (oferta, rekomendacje, dopasowanie), nie z odpłatności.
        core = [n for n in present_names if n in (REQUIRED, *ANY_OF)]
        strongest = max(core or present_names, key=lambda n: signals[n], default=None)
        if strongest is None and llm:
            # LLM rozpoznał usługę, a przesłanki regex są słabe — cytat z najmocniejszej z nich.
            quoted = [n for n in SIGNAL_RULES if hits[n].quote and n != "disclaimer"]
            strongest = max(quoted, key=lambda n: hits[n].score, default=None)
        violation = probability_ >= VIOLATION_MIN
        reason = (
            "Przesłanki doradztwa inwestycyjnego: "
            + ", ".join(SIGNAL_NAMES[n] for n in present_names)
            + "."
            if present_names
            else "Brak przesłanek doradztwa inwestycyjnego."
        )
        if llm:
            verdict = ", ".join(
                f"{SERVICE_NAMES[name]} P={p:.2f}".replace(".", ",") for name, p in llm.items()
            )
            reason = f"{reason} Ocena modelu językowego: {verdict}."

        findings.insert(
            0,
            Finding(
                ADVISORY_RULE,
                "violation" if violation else "ok",
                round(probability_ if violation else 1 - probability_, 3),
                hits[strongest].quote if violation and strongest else None,
                reason,
                {"violation": probability_, "ok": 1 - probability_, "n/a": 0.0},
            ),
        )
    return findings


def summarize(probability_: float, signals: dict[str, float], subject: Subject) -> str:
    present = [
        SIGNAL_NAMES[n] for n in SIGNAL_RULES if signals[n] >= SIGNAL_MIN and n != "disclaimer"
    ]
    who = f"{subject.name}: " if subject.name else ""
    pct = f"{probability_:.2f}".replace(".", ",")
    if probability_ >= VIOLATION_MIN:
        return (
            f"{who}prawdopodobna oferta doradztwa inwestycyjnego (P={pct}) — {', '.join(present)}."
        )
    if present:
        return f"{who}pojedyncze przesłanki doradztwa (P={pct}): {', '.join(present)} — za mało, by uznać za doradztwo."
    return f"{who}brak przesłanek doradztwa inwestycyjnego."


def analyze_advisory(
    text: str,
    rules: list[str] | None = None,
    *,
    llm: dict[str, float] | None = None,
) -> AdvisoryAnalysis:
    """M3 z reguł regex; `llm` = P(TAK) usług z SERVICES od modelu (wariant hybrid).

    Z `llm` werdykt (P i etykieta) wydaje model, a regex daje przesłanki i cytaty.
    """
    paragraphs = split_paragraphs(text)
    hits = {name: _signal(paragraphs, name) for name in _SIGNALS}
    signals = {name: hit.score for name, hit in hits.items()}
    # Zastrzeżenie liczy się tylko przy ofercie indywidualnej (inaczej to zwykła nota edukacyjna).
    if max(signals["offer"], signals["personal"]) < VIOLATION_MIN:
        signals["disclaimer"] = 0.0
    service: str | None = None
    if llm:
        service = max(llm, key=llm.__getitem__)
        p = round(llm[service], 3)
    else:
        p = round(probability(signals), 3)
    subject = extract_subject(text)
    requested = set(rules) if rules else set(RULE_IDS)
    return AdvisoryAnalysis(
        probability=p,
        label=POSITIVE_LABEL if p >= VIOLATION_MIN else NEGATIVE_LABEL,
        findings=_findings(p, hits, signals, requested, llm),
        summary=summarize(p, signals, subject),
        signals=signals,
        subject=subject,
        engine="hybrid" if llm else "rules",
        llm=llm or {},
        service=service if p >= VIOLATION_MIN else None,
    )


# ─── Wariant hybrid: Bielik wydaje werdykt (P(TAK) z logprobs) ──────────────────────────────────

LLM_SYSTEM_PROMPT = (
    "Jesteś analitykiem Urzędu Komisji Nadzoru Finansowego. Sprawdzasz, czy autor tekstu ze strony "
    "internetowej lub z filmu oferuje klientom usługę inwestycyjną, na którą w Polsce potrzebne jest "
    "zezwolenie KNF. Odpowiadasz rzetelnie, tylko na podstawie tekstu."
)

# Po 2 przykłady TAK i NIE, na przemian, ostatni NIE (ostatni przykład najmocniej ciągnie
# odpowiedź). Negatywy to przypadki graniczne: własny portfel autora, rekomendacja ogólna dla
# wszystkich z notą „to nie jest porada”, edukacja. Przykłady nie są cytatami z ocenianych materiałów.
LLM_QUESTIONS: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "advisory": (
        "Doradztwo inwestycyjne (art. 76 ustawy o obrocie instrumentami finansowymi) to "
        "rekomendacje kupna, sprzedaży lub trzymania instrumentów finansowych (akcji, obligacji, "
        "funduszy, ETF, kontraktów, kryptowalut-instrumentów) przygotowane dla konkretnego klienta, "
        "z uwzględnieniem jego sytuacji i potrzeb. Ogólne opinie i analizy dla wszystkich "
        "odbiorców to NIE doradztwo.\n"
        "Czy autor tekstu oferuje klientom doradztwo inwestycyjne (także płatne konsultacje, "
        "mentoring albo grupę, w której dobiera inwestycje pod klienta)?",
        [
            (
                "Na konsultacji 1:1 przeanalizujemy Twój portfel i powiemy, które spółki dokupić.",
                "TAK",
            ),
            ("Dobierzemy fundusze i obligacje do Twoich celów i horyzontu inwestycyjnego.", "TAK"),
            ("Kupiłem w tym miesiącu akcje PKN Orlen — pokazuję cały mój portfel.", "NIE"),
            (
                "Nasz analityk uważa, że kurs CD Projekt wzrośnie do 200 zł. To nie jest porada inwestycyjna.",
                "NIE",
            ),
        ],
    ),
    "portfolio": (
        "Zarządzanie portfelem to podejmowanie decyzji inwestycyjnych i zawieranie transakcji na "
        "rachunku klienta w jego imieniu (klient powierza środki albo daje pełnomocnictwo).\n"
        "Czy autor tekstu oferuje klientom zarządzanie ich pieniędzmi, majątkiem albo portfelem "
        "inwestycyjnym?",
        [
            (
                "Powierz nam swoje oszczędności — zainwestujemy je za Ciebie i co miesiąc wyślemy raport.",
                "TAK",
            ),
            ("W tym filmie tłumaczę, jak samemu zbudować portfel z ETF.", "NIE"),
            (
                "Udziel nam pełnomocnictwa do rachunku, a nasi traderzy będą handlować na Twoim koncie.",
                "TAK",
            ),
            ("Zarządzam własnym portfelem od 10 lat — oto moje wyniki.", "NIE"),
        ],
    ),
}


def _llm_question(name: str) -> str:
    question, examples = LLM_QUESTIONS[name]
    shown = "".join(f"- „{example}” → {answer}\n" for example, answer in examples)
    return f"{question}\nPrzykłady:\n{shown}Odpowiedz jednym słowem: TAK albo NIE."


def llm_signals(
    text: str,
    *,
    model: str | None = None,
    ollama_url: str | None = None,
    client: httpx.Client | None = None,
) -> dict[str, float]:
    """P(TAK) dla każdej usługi z SERVICES (logprobs, skalibrowane jak w M2)."""
    url = (ollama_url or os.environ.get("OLLAMA_URL") or risk_llm.DEFAULT_OLLAMA_URL).rstrip("/")
    name = model or os.environ.get("OLLAMA_RISK_MODEL") or risk_llm.DEFAULT_MODEL
    http = client or httpx.Client(timeout=risk_llm.TIMEOUT)
    try:
        ollama = risk_llm.Ollama(url, name, http, system=LLM_SYSTEM_PROMPT)
        prefix = risk_llm.material_message(text)
        result: dict[str, float] = {}
        for service in SERVICES:
            body = ollama.chat(
                [{"role": "user", "content": prefix + _llm_question(service)}],
                logprobs=True,
                top_logprobs=20,
                options={"temperature": 0, "num_predict": 1, "num_ctx": risk_llm.NUM_CTX},
            )
            try:
                top = body["logprobs"][0]["top_logprobs"]
            except (KeyError, IndexError, TypeError) as exc:
                raise risk_llm.LlmError("Ollama nie zwróciła logprobs") from exc
            result[service] = round(risk_llm.calibrate(risk_llm.binary_probability(top)), 3)
        return result
    finally:
        if client is None:
            http.close()


def analyze_advisory_engine(text: str, rules: list[str] | None = None) -> AdvisoryAnalysis:
    """M3 wg M3_ENGINE: `rules` (regex) albo `hybrid` (werdykt LLM). Błąd LLM → wynik z regex."""
    base = analyze_advisory(text, rules)
    if os.environ.get("M3_ENGINE", "rules") != "hybrid":
        return base
    if base.signals[REQUIRED] < LLM_GATE:
        return base
    try:
        return analyze_advisory(text, rules, llm=llm_signals(text))
    except risk_llm.LlmError:
        log.warning("Ocena M3 przez LLM nie powiodła się — wynik z reguł regex", exc_info=True)
        return base
