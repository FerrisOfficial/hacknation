"""Testy danych referencyjnych KNF bez sieci: fixture HTML listy ostrzeżeń i dane RSC wyszukiwarki
budowane z JSON-a (jak na stronie KNF: `self.__next_f.push([1, "<escapowany strumień>"])`)."""

import json
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from ml import knf
from ml.knf import (
    Identifier,
    KnfError,
    extract_domains,
    extract_identifiers,
    is_active_investment_register,
    parse_entity_search,
    parse_public_warnings,
    search_entities,
)
from ml.main import app

client = TestClient(app)

WARNINGS_HTML = (Path(__file__).parent / "fixtures" / "knf_warnings.html").read_text(
    encoding="utf-8"
)

BROKER = {
    "id": 1001,
    "deleted": 0,
    "type": "COMPANY",
    "name": "Broker Przykładowy S.A.<br /><strike>Dom Maklerski Przykład S.A.</strike>",
    "category": 1,
    "subcategory": 19,
    "subcategoryName": "Firmy inwestycyjne - Domy maklerskie",
    "attributes": [
        {"name": "Ulica", "value": "ul. Prosta 1"},
        {"name": "Zakres działalności", "value": "1, 2, 3, 9"},
        {
            "name": "Strona",
            "value": "www.broker.example<br /><strike>www.stary-broker.example</strike>",
        },
        {"name": "Adres e-mail", "value": "relacje.inwestorskie@broker.example"},
        {"name": "Pusty", "value": "<strike>nieaktualne</strike>"},
    ],
    "detailHref": "#1001",
}
FOREIGN = {
    "id": 1002,
    "deleted": 0,
    "name": "Broker Ltd",
    "subcategory": 57000,
    "subcategoryName": "Notyfikacje zagranicznych firm inwestycyjnych na terytorium RP",
    "attributes": [
        {"name": "Organ nadzoru", "value": "www.nadzor.example"},
        {"name": "Dodatkowe informacje", "value": "www.broker.example/cy &amp; inne"},
    ],
}
REVOKED = {
    "id": 1003,
    "deleted": 0,
    "name": "Dawny Dom Maklerski S.A.",
    "subcategoryName": "Firmy inwestycyjne - którym cofnięto zezwolenie na prowadzenie dz.",
    "attributes": [],
}
ISSUER = {
    "id": 1004,
    "deleted": 0,
    "name": "Broker Przykładowy SA",
    "subcategoryName": "Emitenci akcji - rynek regulowany",
    "attributes": None,
}


def rsc_html(results: list[object], *, total: int, page: int = 1, per_page: int = 50) -> str:
    results_json = json.dumps(results, ensure_ascii=False)
    stream = (
        '2a:I[48446,["8500","$19"],"$41"]\n'
        f'39:["$","$L3d",null,{{"parentId":0,"results":{results_json}}}]\n'
        f'3e:["$","$L44",null,{{"results":"$39:props:results","totalCount":{total},'
        f'"currentPage":{page},"perPage":{per_page},"hasSearched":true}}]\n'
    )
    # Strona dzieli strumień na kilka wywołań `push` — sklejamy je przy odczycie.
    middle = len(stream) // 2
    pushes = "".join(
        f"<script>self.__next_f.push([1,{json.dumps(part)}])</script>"
        for part in (stream[:middle], stream[middle:])
    )
    return f"<!doctype html><html><body><main>Wyszukiwarka</main>{pushes}</body></html>"


# ─── Lista ostrzeżeń ────────────────────────────────────────────────────────────────────────────


def test_parse_public_warnings() -> None:
    bank, fx, person = parse_public_warnings(WARNINGS_HTML)

    assert bank.category.startswith(
        "Zawiadomienia o podejrzeniu popełnienia przestępstwa z art. 171"
    )
    assert bank.number == 1
    assert bank.identifiers == ()
    assert bank.rulings is None
    assert bank.domains == ("home.bank-przyklad.example", "bank-przyklad2.example")

    assert "art. 178 ustawy o obrocie instrumentami finansowymi" in fx.category
    assert fx.entities == (
        "1. FX Zysk sp. z o.o. z siedzibą w Warszawie (www.fx-zysk.example)\n"
        "2. Zysk Capital S.A. z siedzibą w Krakowie"
    )
    assert fx.identifiers == (
        Identifier(kind="KRS", value="0000123456"),
        Identifier(kind="NIP", value="1234567890"),
    )
    assert fx.prosecutor == "Prokuratura Okręgowa w Krakowie"
    assert fx.rulings == "Sąd Rejonowy wydał wyrok skazujący."
    assert fx.domains == ("fx-zysk.example", "zysk-capital.example")

    assert person.number == 2
    assert person.identifiers == (Identifier(kind="REGON", value="123456789"),)
    assert (person.prosecutor, person.notes, person.domains) == (None, None, ())


def test_parse_public_warnings_without_tables_fails() -> None:
    with pytest.raises(KnfError):
        parse_public_warnings("<html><body><p>Przerwa techniczna</p></body></html>")


def test_extract_domains_skips_abbreviations_paths_and_email_names() -> None:
    text = (
        "Spółka sp. z o.o., S.A., m.in. www.firma.example/regulamin.html, "
        "kontakt@poczta.example, wersja 1.5, www.literowka bez TLD, FIRMA.EXAMPLE"
    )
    assert extract_domains(text) == ("firma.example", "poczta.example")


def test_extract_identifiers() -> None:
    assert extract_identifiers("KRS: 0000 123 456, NIP 123-456-78-90; REGON 123456789") == (
        Identifier(kind="KRS", value="0000123456"),
        Identifier(kind="NIP", value="1234567890"),
        Identifier(kind="REGON", value="123456789"),
    )


# ─── Wyszukiwarka podmiotów ─────────────────────────────────────────────────────────────────────


def test_parse_entity_search() -> None:
    html = rsc_html([BROKER, FOREIGN, REVOKED, ISSUER, {"id": "zły"}], total=7)
    page = parse_entity_search(html, "Broker")
    assert (page.phrase, page.total, page.page, page.per_page) == ("Broker", 7, 1, 50)
    broker, foreign, revoked, issuer = page.entities

    assert broker.name == "Broker Przykładowy S.A."
    assert broker.former_names == ("Dom Maklerski Przykład S.A.",)
    assert broker.register_name == "Firmy inwestycyjne - Domy maklerskie"
    assert broker.register_id == 19
    assert broker.investment_register is True
    assert [(a.name, a.value) for a in broker.attributes] == [
        ("Ulica", "ul. Prosta 1"),
        ("Zakres działalności", "1, 2, 3, 9"),
        ("Strona", "www.broker.example"),
        ("Adres e-mail", "relacje.inwestorskie@broker.example"),
    ]
    assert broker.domains == ("broker.example",)
    assert broker.detail_url == f"{knf.ENTITIES_URL}#1001"

    assert foreign.investment_register is True
    assert foreign.domains == ("broker.example",)  # bez strony nadzorcy
    assert foreign.attributes[1].value == "www.broker.example/cy & inne"
    assert revoked.investment_register is False
    assert issuer.investment_register is False
    assert issuer.attributes == ()


def test_parse_entity_search_empty_and_broken() -> None:
    empty = parse_entity_search(rsc_html([], total=0), "nic")
    assert (empty.total, empty.entities) == (0, ())
    with pytest.raises(KnfError):
        parse_entity_search("<html><body>Błąd</body></html>", "x")


def test_is_active_investment_register() -> None:
    assert is_active_investment_register("Agenci firm inwestycyjnych - osoby fizyczne")
    assert is_active_investment_register("Banki prowadzące działalność maklerską")
    # Na stronie KNF ta nazwa ma półpauzę (en dash), nie łącznik.
    assert not is_active_investment_register("Firmy inwestycyjne \N{EN DASH} dane historyczne")
    assert not is_active_investment_register("Zakłady ubezpieczeń")


def test_search_entities_builds_query_and_caps_page_size() -> None:
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, text=rsc_html([BROKER], total=1))

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        page = search_entities("xtb.com", page=2, per_page=500, client=http)

    assert page.entities[0].id == 1001
    params = seen[0].params
    assert seen[0].path == "/podmioty/wyszukiwarka_podmiotow"
    assert (params["searchPhrase"], params["page"], params["perPage"]) == ("xtb.com", "2", "50")
    assert (params["includeDeleted"], params["searched"]) == ("false", "1")


# ─── Endpointy ──────────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_knf_warnings_endpoint() -> None:
    respx.get(knf.WARNINGS_URL).mock(
        return_value=httpx.Response(200, text=WARNINGS_HTML, headers={"content-type": "text/html"})
    )
    response = client.get("/knf/warnings")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    assert body[1]["identifiers"][0] == {"kind": "KRS", "value": "0000123456"}
    assert body[1]["domains"] == ["fx-zysk.example", "zysk-capital.example"]


@respx.mock
def test_knf_warnings_endpoint_upstream_error_is_502() -> None:
    respx.get(knf.WARNINGS_URL).mock(return_value=httpx.Response(503))
    assert client.get("/knf/warnings").status_code == 502


@respx.mock
def test_knf_entities_endpoint() -> None:
    respx.get(url__startswith=knf.ENTITIES_URL).mock(
        return_value=httpx.Response(200, text=rsc_html([BROKER, ISSUER], total=2))
    )
    response = client.get("/knf/entities", params={"q": "Broker"})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [e["investment_register"] for e in body["entities"]] == [True, False]
    assert body["entities"][0]["former_names"] == ["Dom Maklerski Przykład S.A."]


def test_knf_entities_endpoint_validates_input() -> None:
    assert client.get("/knf/entities", params={"q": "x"}).status_code == 422
    assert client.get("/knf/entities", params={"q": "xtb", "per_page": 51}).status_code == 422
    assert client.get("/knf/entities", params={"q": "xtb", "page": 0}).status_code == 422
