from functools import cache

import pytest
from fastapi.testclient import TestClient

from ml import risk_web
from ml.main import app
from ml.risk_web import (
    Block,
    HiddenBy,
    PageRender,
    RiskLink,
    View,
    measure,
    rule_7,
    rule_8,
    with_base,
)

WARNING = "Inwestowanie w CFD wiąże się z wysokim ryzykiem utraty kapitału."
SCREENS = [name for name, *_ in risk_web.VIEWPORTS]


def view(font_px: float = 16.0, cut: bool = False, text: str = WARNING) -> View:
    return View(None, text, font_px, cut)


def hidden(by: HiddenBy) -> View:
    return View(by, "", 16.0, False)


def block(text: str = WARNING, **views: View) -> Block:
    return Block(text, {name: views.get(name, view(text=text)) for name in SCREENS})


# ─── Decyzje (bez przeglądarki) ──────────────────────────────────────────────────────────────


def test_rule_7_visible_hidden_link_and_absent() -> None:
    assert rule_7(PageRender([block()], [])).result == "ok"

    closed = block(komputer=hidden("details"))
    finding = rule_7(PageRender([closed], []))
    assert finding.result == "violation" and "<details>" in finding.reason
    assert finding.quote == WARNING

    link = RiskLink("Ostrzeżenie o ryzyku", "https://example.com/ryzyko.pdf")
    only_link = rule_7(
        PageRender([block("Pomagamy inwestować bez ryzyka nudy na co dzień")], [link])
    )
    assert only_link.result == "violation" and "ryzyko.pdf" in only_link.reason

    assert rule_7(PageRender([], [])).result == "n/a"
    # Ostrzeżenie w tekście ze scrapingu, ale nie w renderze (strona budowana JavaScriptem).
    assert rule_7(PageRender([], [link]), WARNING).result == "n/a"


def test_rule_7_visible_parent_with_hidden_child() -> None:
    # <div> widać, ale jego ostrzeżenie jest w zamkniętym <details>: innerText go nie zawiera.
    parent = block(f"Zysk do 20%! Więcej {WARNING}", komputer=view(text="Zysk do 20%! Więcej"))
    child = block(komputer=hidden("details"))
    assert rule_7(PageRender([parent, child], [])).result == "violation"


def test_rule_8_small_hidden_cut_and_ok() -> None:
    assert rule_8(PageRender([block()], [])).result == "ok"

    small = rule_8(PageRender([block(telefon=view(6.0))], []))
    assert small.result == "violation" and "telefon: czcionka 6 px" in small.reason

    on_phone = rule_8(PageRender([block(telefon=hidden("css"))], []))
    assert on_phone.result == "violation" and "telefon: ostrzeżenie ukryte" in on_phone.reason

    cut = rule_8(PageRender([block(tablet=view(cut=True))], []))
    assert cut.result == "violation" and "tablet: tekst ucięty" in cut.reason

    assert rule_8(PageRender([block(komputer=hidden("details"))], [])).result == "n/a"


def test_with_base_inserts_base_once() -> None:
    html = with_base("<html><head><title>x</title></head></html>", "https://firma.pl/oferta")
    assert '<head><base href="https://firma.pl/oferta">' in html
    assert with_base(html, "https://inna.pl/") == html


# ─── Renderowanie w Chromium ─────────────────────────────────────────────────────────────────


@cache
def _chromium_available() -> bool:
    try:
        measure("<p>test</p>", "https://example.com/")
    except Exception:
        return False
    return True


browser = pytest.mark.skipif(
    "not _chromium_available()", reason="Brak Chromium: uv run playwright install chromium"
)

VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">'


def page(body: str, head: str = VIEWPORT) -> str:
    return f"<!doctype html><html lang='pl'><head>{head}</head><body>{body}</body></html>"


def render(html: str) -> PageRender:
    return measure(html, "https://example.com/")


@browser
def test_render_visible_warning_passes_both_rules() -> None:
    result = render(page(f"<h1>Inwestuj z nami</h1><p style='font-size:16px'>{WARNING}</p>"))
    assert rule_7(result).result == "ok"
    assert rule_8(result).result == "ok", rule_8(result).reason


@browser
def test_render_warning_in_closed_details_violates_rule_7() -> None:
    html = page(f"<div><p>Zysk do 20%!</p><details><summary>Więcej</summary><p>{WARNING}</p>"
                "</details></div>")  # fmt: skip
    finding = rule_7(render(html))
    assert finding.result == "violation" and "<details>" in finding.reason


@browser
def test_render_tiny_font_and_missing_viewport_violate_rule_8() -> None:
    tiny = rule_8(render(page(f"<p style='font-size:9px'>{WARNING}</p>")))
    assert tiny.result == "violation" and "komputer: czcionka 9 px" in tiny.reason

    # Bez <meta viewport> telefon układa stronę na 980 px i pomniejsza: 14 px -> ok. 5 px.
    no_viewport = rule_8(render(page(f"<p style='font-size:14px'>{WARNING}</p>", head="")))
    assert no_viewport.result == "violation" and "telefon: czcionka 5 px" in no_viewport.reason


@browser
def test_render_warning_hidden_on_phone_violates_rule_8() -> None:
    style = "<style>@media (max-width: 600px) { .risk { display: none } }</style>"
    finding = rule_8(render(page(f"<p class='risk'>{WARNING}</p>", head=VIEWPORT + style)))
    assert finding.result == "violation" and "telefon: ostrzeżenie ukryte" in finding.reason


@browser
def test_render_nested_bold_warning_esma_wording() -> None:
    # Jak na xtb.com/pl: ostrzeżenie ESMA w <span>, pogrubiony fragment w <b>, link w <a>.
    html = page(
        "<footer><span style='font-size:13px'><b>79% rachunków inwestorów detalicznych "
        "odnotowuje straty pieniężne w wyniku handlu kontraktami CFD.</b> Zastanów się, czy "
        "<a href='/ryzyko.pdf'>możesz pozwolić sobie na wysokie ryzyko utraty pieniędzy.</a>"
        "</span></footer>"
    )
    result = render(html)
    assert rule_7(result).result == "ok"
    eight = rule_8(result)
    assert eight.result == "ok" and "telefon 13 px" in eight.reason


@browser
def test_render_strips_meta_refresh() -> None:
    head = VIEWPORT + '<meta http-equiv="refresh" content="0; url=https://example.com/inna">'
    assert rule_7(render(page(f"<p>{WARNING}</p>", head=head))).result == "ok"


@browser
def test_analyze_endpoint_with_page() -> None:
    html = page(f"<p>Zysk do 20%!</p><details><summary>Więcej</summary><p>{WARNING}</p></details>")
    body = {
        "material_id": "strona-1",
        "module": "risk_disclosure",
        "text": f"Zysk do 20%!\n\n{WARNING}",
        "rules": ["3", "7", "8"],
        "page": {"url": "https://example.com/oferta", "html": html},
    }
    findings = {
        f["rule_id"]: f for f in TestClient(app).post("/analyze", json=body).json()["findings"]
    }
    assert findings["7"]["result"] == "violation"
    assert findings["8"]["result"] == "n/a"


def test_analyze_endpoint_render_failure_gives_na(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(html: str, url: str) -> PageRender:
        raise RuntimeError("brak przeglądarki")

    monkeypatch.setattr(risk_web, "measure", broken)
    body = {
        "material_id": "strona-2",
        "module": "risk_disclosure",
        "text": WARNING,
        "rules": ["7"],
        "page": {"url": "https://example.com/", "html": "<p>x</p>"},
    }
    findings = TestClient(app).post("/analyze", json=body).json()["findings"]
    seven = next(f for f in findings if f["rule_id"] == "7")
    assert seven["result"] == "n/a" and "RuntimeError" in seven["reason"]
    assert [f["rule_id"] for f in findings].count("8") == 0
