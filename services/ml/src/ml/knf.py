"""Dane referencyjne KNF: lista ostrzeżeń publicznych i wyszukiwarka podmiotów (rejestry).

Bez nich moduły AI nie rozstrzygną, czy firma ma zezwolenie (moduły 1 i 2) albo czy działa bez
niego (moduł 3). Strony KNF to Next.js:
- lista ostrzeżeń jest w HTML-u: jedna sekcja z tabelą na każdą podstawę prawną zawiadomienia,
- wyniki wyszukiwarki podmiotów są w danych RSC (`self.__next_f.push(...)`) osadzonych w stronie.

Bezstanowy — zapis do bazy robi wołający.
"""

import html as html_lib
import json
import re
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from selectolax.lexbor import LexborHTMLParser, LexborNode

from ml.scraper import DEFAULT_TIMEOUT, normalize_text, pick_user_agent, proxy_from_env

WARNINGS_URL = "https://www.knf.gov.pl/dla_konsumenta/ostrzezenia_publiczne"
ENTITIES_URL = "https://www.knf.gov.pl/podmioty/wyszukiwarka_podmiotow"
MAX_PER_PAGE = 50

_IDENTIFIER_RE = re.compile(r"\b(KRS|NIP|REGON)\s*:?\s*(\d[\d \-]{6,16}\d)")
# Domeny w tekście („www.grandtrade.exchange”, „Ulgaoddlugu.pl”, „office@xtb.com”). TLD z liter,
# więc „sp. z o.o.”, „S.A.” czy „1.5” nie pasują.
_DOMAIN_RE = re.compile(
    r"(?<![\w./-])(?:https?://)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})"
    r"\b(?!@)",  # „relacje.inwestorskie@xtb.com”: część przed @ to nie domena
    re.IGNORECASE,
)
_NOT_DOMAINS = frozenset({"m.in", "t.j", "j.w"})
_RSC_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')
_RSC_META_RE = re.compile(r'"totalCount":(\d+),"currentPage":(\d+),"perPage":(\d+)')
_STRIKE_RE = re.compile(r"<strike>(.*?)</strike>", re.IGNORECASE | re.DOTALL)
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
# Rejestry związane z usługami inwestycyjnymi: firmy inwestycyjne, domy maklerskie, notyfikacje
# firm z EOG, agenci firm inwestycyjnych, banki z działalnością maklerską…
_INVESTMENT_REGISTER_RE = re.compile(r"firm\w* inwestycyjn|maklersk", re.IGNORECASE)
# …ale nie dane historyczne ani firmy, którym cofnięto zezwolenie (te już go nie mają).
_INACTIVE_REGISTER_RE = re.compile(r"historyczn|cofnięt|wykreślon", re.IGNORECASE)
# Atrybuty z domenami, które nie należą do podmiotu (np. strona zagranicznego nadzorcy).
_ATTRIBUTES_WITHOUT_OWN_DOMAINS = frozenset({"Organ nadzoru"})


class KnfError(Exception):
    """Strony KNF nie udało się pobrać albo zmienił się jej format."""


@dataclass(frozen=True)
class Identifier:
    kind: str
    value: str


@dataclass(frozen=True)
class PublicWarning:
    # Podstawa prawna zawiadomienia, np. „… z art. 178 ustawy o obrocie instrumentami
    # finansowymi (prowadzenie działalności … bez wymaganego zezwolenia …)”.
    category: str
    number: int
    entities: str
    identifiers: tuple[Identifier, ...]
    prosecutor: str | None
    rulings: str | None
    notes: str | None
    domains: tuple[str, ...]


@dataclass(frozen=True)
class EntityAttribute:
    name: str
    value: str


@dataclass(frozen=True)
class RegisteredEntity:
    id: int
    name: str
    former_names: tuple[str, ...]
    deleted: bool
    register_name: str
    register_id: int | None
    investment_register: bool
    attributes: tuple[EntityAttribute, ...]
    domains: tuple[str, ...]
    detail_url: str


@dataclass(frozen=True)
class EntitySearchPage:
    phrase: str
    total: int
    page: int
    per_page: int
    entities: tuple[RegisteredEntity, ...]


def extract_domains(*texts: str) -> tuple[str, ...]:
    found: dict[str, None] = {}
    for text in texts:
        for match in _DOMAIN_RE.finditer(text):
            domain = match.group(1).lower().removeprefix("www.")
            # Bez kropki to nie domena („www.firma” bez TLD — literówka w danych).
            if "." in domain and domain not in _NOT_DOMAINS:
                found[domain] = None
    return tuple(found)


def extract_identifiers(text: str) -> tuple[Identifier, ...]:
    return tuple(
        Identifier(kind=kind, value=re.sub(r"[ \-]", "", value))
        for kind, value in _IDENTIFIER_RE.findall(text)
    )


def _client() -> httpx.Client:
    return httpx.Client(proxy=proxy_from_env(), timeout=DEFAULT_TIMEOUT, follow_redirects=True)


def _get(url: str, client: httpx.Client | None) -> str:
    own_client = client is None
    http = client or _client()
    headers = {"User-Agent": pick_user_agent(), "Accept-Language": "pl-PL,pl;q=0.9"}
    try:
        response = http.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise KnfError(f"Nie udało się pobrać {url}: {exc}") from exc
    finally:
        if own_client:
            http.close()
    if response.status_code >= 400:
        raise KnfError(f"{url} zwrócił HTTP {response.status_code}")
    return response.text


# ─── Lista ostrzeżeń publicznych ────────────────────────────────────────────────────────────────


def _cell(node: LexborNode) -> str | None:
    text = normalize_text(node.text(separator="", deep=True))
    return None if text in ("", "-") else text


def parse_public_warnings(html: str) -> list[PublicWarning]:
    tree = LexborHTMLParser(html)
    warnings: list[PublicWarning] = []
    for section in tree.css("section.table-with-header-parent"):
        title = section.css_first(".title")
        if title is None:
            continue
        category = normalize_text(title.text(separator=" ", deep=True))
        for row in section.css("table.warning-list-table tbody tr"):
            cells = [_cell(td) for td in row.css("td")]
            if len(cells) < 6 or not cells[1]:
                continue
            number, entities, identifiers, prosecutor, rulings, notes = cells[:6]
            warnings.append(
                PublicWarning(
                    category=category,
                    number=int(re.sub(r"\D", "", number or "") or 0),
                    entities=entities or "",
                    identifiers=extract_identifiers(identifiers or ""),
                    prosecutor=prosecutor,
                    rulings=rulings,
                    notes=notes,
                    domains=extract_domains(entities or "", notes or ""),
                )
            )
    if not warnings:
        raise KnfError("Na stronie KNF nie znaleziono tabel ostrzeżeń (zmiana formatu strony?)")
    return warnings


def fetch_public_warnings(*, client: httpx.Client | None = None) -> list[PublicWarning]:
    return parse_public_warnings(_get(WARNINGS_URL, client))


# ─── Wyszukiwarka podmiotów ─────────────────────────────────────────────────────────────────────


def _html_text(fragment: str) -> str:
    return normalize_text(html_lib.unescape(_TAG_RE.sub("", _BR_RE.sub("\n", fragment))))


def _current_and_former(fragment: str) -> tuple[str, list[str]]:
    """Wartość bez przekreśleń i lista przekreślonych (dawne nazwy, adresy, domeny)."""
    former = [
        line for struck in _STRIKE_RE.findall(fragment) for line in _html_text(struck).split("\n")
    ]
    return _html_text(_STRIKE_RE.sub("", fragment)), [line for line in former if line]


def entity_search_url(phrase: str, *, page: int, per_page: int, include_deleted: bool) -> str:
    params = {
        "searchPhrase": phrase,
        "includeDeleted": str(include_deleted).lower(),
        "searched": "1",
        "page": str(page),
        "perPage": str(per_page),
    }
    return f"{ENTITIES_URL}?{urlencode(params)}"


def _rsc_stream(html: str) -> str:
    try:
        return "".join(json.loads(f'"{chunk}"') for chunk in _RSC_CHUNK_RE.findall(html))
    except json.JSONDecodeError as exc:
        raise KnfError("Nie udało się odczytać danych wyszukiwarki KNF") from exc


def is_active_investment_register(register_name: str) -> bool:
    """Aktualny wpis w rejestrze usług inwestycyjnych (bez danych historycznych i cofniętych)."""
    return bool(_INVESTMENT_REGISTER_RE.search(register_name)) and not (
        _INACTIVE_REGISTER_RE.search(register_name)
    )


def _parse_entity(raw: object) -> RegisteredEntity | None:
    if not isinstance(raw, dict):
        return None
    entity_id = raw.get("id")
    name_html = raw.get("name")
    if not isinstance(entity_id, int) or not isinstance(name_html, str):
        return None
    name, former_names = _current_and_former(name_html)
    register_name = raw.get("subcategoryName")
    register_name = register_name if isinstance(register_name, str) else ""
    register_id = raw.get("subcategory")

    attributes: list[EntityAttribute] = []
    raw_attributes = raw.get("attributes")
    for attribute in raw_attributes if isinstance(raw_attributes, list) else []:
        if not isinstance(attribute, dict):
            continue
        label, value = attribute.get("name"), attribute.get("value")
        if isinstance(label, str) and isinstance(value, str):
            current, _ = _current_and_former(value)
            if current:
                attributes.append(EntityAttribute(name=label, value=current))

    deleted = bool(raw.get("deleted"))
    return RegisteredEntity(
        id=entity_id,
        name=name,
        former_names=tuple(former_names),
        deleted=deleted,
        register_name=register_name,
        register_id=register_id if isinstance(register_id, int) else None,
        investment_register=is_active_investment_register(register_name) and not deleted,
        attributes=tuple(attributes),
        domains=extract_domains(
            *(
                attribute.value
                for attribute in attributes
                if attribute.name not in _ATTRIBUTES_WITHOUT_OWN_DOMAINS
            )
        ),
        detail_url=f"{ENTITIES_URL}#{entity_id}",
    )


def parse_entity_search(html: str, phrase: str) -> EntitySearchPage:
    stream = _rsc_stream(html)
    meta = _RSC_META_RE.search(stream)
    total, page, per_page = (int(group) for group in meta.groups()) if meta else (0, 1, 0)

    marker = stream.find('"results":[')
    if marker < 0:
        if meta is None:
            raise KnfError("Na stronie KNF nie znaleziono wyników (zmiana formatu strony?)")
        return EntitySearchPage(
            phrase=phrase, total=total, page=page, per_page=per_page, entities=()
        )
    try:
        results, _ = json.JSONDecoder().raw_decode(stream, marker + len('"results":'))
    except json.JSONDecodeError as exc:
        raise KnfError("Nie udało się odczytać wyników wyszukiwarki KNF") from exc
    if not isinstance(results, list):
        raise KnfError("Nieoczekiwany format wyników wyszukiwarki KNF")

    entities = tuple(
        entity for entity in (_parse_entity(raw) for raw in results) if entity is not None
    )
    return EntitySearchPage(
        phrase=phrase,
        total=total or len(entities),
        page=page,
        per_page=per_page or len(entities),
        entities=entities,
    )


def search_entities(
    phrase: str,
    *,
    page: int = 1,
    per_page: int = MAX_PER_PAGE,
    include_deleted: bool = False,
    client: httpx.Client | None = None,
) -> EntitySearchPage:
    """Szuka po nazwie, numerze albo domenie (np. „XTB”, „xtb.com”) we wszystkich rejestrach KNF."""
    url = entity_search_url(
        phrase, page=page, per_page=min(per_page, MAX_PER_PAGE), include_deleted=include_deleted
    )
    return parse_entity_search(_get(url, client), phrase)
