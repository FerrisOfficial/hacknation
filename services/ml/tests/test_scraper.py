"""Testy scrapera bez sieci: httpx.MockTransport i respx zamiast prawdziwych żądań."""

import random
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from ml.main import app
from ml.scraper import (
    USER_AGENTS,
    ScrapeError,
    content_hash,
    extract,
    extract_links,
    normalize_text,
    proxy_from_env,
    scrape,
)

AD_HTML = (Path(__file__).parent / "fixtures" / "ad_page.html").read_text(encoding="utf-8")
URL = "https://fx-zysk.example/oferta"

client = TestClient(app)


def _mock_client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler, follow_redirects=True)


def _html_response(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text=AD_HTML, headers={"content-type": "text/html; charset=utf-8"})


def test_extract_main_text_without_noise() -> None:
    page = extract(AD_HTML)
    assert page.title == "Zarabiaj 30% miesięcznie na forex"
    assert page.language == "pl-pl"
    assert page.author == "Jan Finfluencer"
    assert page.description == "Gwarantowany zysk bez ryzyka."
    assert page.text == (
        "Zarabiaj 30% miesięcznie\n"
        "Dołącz do tysięcy inwestorów. Gwarantowany zysk!\n"
        "Bez prowizji\n"
        "Wypłata w 24h"
    )
    for noise in ("tracking", "Logo", "Kontakt", "ukryty", "Zapisz", "Polecane", "©"):
        assert noise not in page.text


def test_extract_falls_back_to_body_and_title() -> None:
    page = extract("<html><head><title> Tytuł </title></head><body><p>a</p><p>b</p></body></html>")
    assert page.title == "Tytuł"
    assert page.text == "a\nb"
    assert page.language is None


def test_extract_links_keeps_outbound_http_links_once() -> None:
    html = (
        '<a href="/regulamin">r</a><a href="https://www.fx-zysk.example/kontakt">k</a>'
        '<a href="https://broker.example/?ref=KOD#top">b</a>'
        '<a href="https://broker.example/?ref=KOD">b</a>'
        '<a href="mailto:a@b.example">m</a><a href="//cdn.example/x">c</a>'
        '<a href="javascript:void(0)">j</a>'
    )
    assert extract_links(html, URL) == ("https://broker.example/?ref=KOD", "https://cdn.example/x")


def test_normalize_text() -> None:
    assert normalize_text("  a\xa0\t b \n\n\n\n c  ") == "a b\n\nc"


def test_content_hash_ignores_whitespace_and_case() -> None:
    assert content_hash("Gwarantowany  ZYSK\n") == content_hash("gwarantowany zysk")
    assert content_hash("a") != content_hash("b")
    assert len(content_hash("a")) == 64


def test_scrape_rotates_user_agent_and_returns_page() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["user-agent"])
        return _html_response(request)

    with _mock_client(httpx.MockTransport(handler)) as http:
        page = scrape(URL, client=http, rng=random.Random(1))

    assert seen[0] in USER_AGENTS
    assert page.user_agent == seen[0]
    assert page.status_code == 200
    assert page.final_url == URL
    assert page.content_hash == content_hash(page.text)
    assert page.html == AD_HTML


def test_scrape_follows_redirects() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/stara":
            return httpx.Response(301, headers={"location": URL})
        return _html_response(request)

    with _mock_client(httpx.MockTransport(handler)) as http:
        page = scrape("https://fx-zysk.example/stara", client=http)
    assert page.url == "https://fx-zysk.example/stara"
    assert page.final_url == URL


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (httpx.Response(404), "HTTP 404"),
        (httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"}), "HTML"),
    ],
)
def test_scrape_rejects_errors_and_non_html(response: httpx.Response, message: str) -> None:
    with (
        _mock_client(httpx.MockTransport(lambda _: response)) as http,
        pytest.raises(ScrapeError, match=message),
    ):
        scrape(URL, client=http)


def test_scrape_wraps_network_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("brak sieci", request=request)

    with _mock_client(httpx.MockTransport(handler)) as http, pytest.raises(ScrapeError):
        scrape(URL, client=http)


def test_proxy_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRAPER_PROXY_URL", "")
    assert proxy_from_env() is None
    monkeypatch.setenv("SCRAPER_PROXY_URL", "http://proxy.local:3128")
    assert proxy_from_env() == "http://proxy.local:3128"


@respx.mock
def test_scrape_endpoint() -> None:
    respx.get(URL).mock(side_effect=_html_response)
    response = client.post("/scrape", json={"url": URL})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Zarabiaj 30% miesięcznie na forex"
    assert body["content_hash"] == content_hash(body["text"])
    assert body["html"] is None

    with_html = client.post("/scrape", json={"url": URL, "include_html": True})
    assert with_html.json()["html"] == AD_HTML


@respx.mock
def test_scrape_endpoint_upstream_error_is_502() -> None:
    respx.get(URL).mock(return_value=httpx.Response(500))
    response = client.post("/scrape", json={"url": URL})
    assert response.status_code == 502


def test_scrape_endpoint_rejects_invalid_url() -> None:
    assert client.post("/scrape", json={"url": "ftp://x"}).status_code == 422
    assert client.post("/scrape", json={"url": "nie-url"}).status_code == 422
