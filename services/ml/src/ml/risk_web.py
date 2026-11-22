"""Moduł 2, reguły 7 i 8 dla stron WWW: zapisany HTML renderowany w Chromium (Playwright).

Renderujemy statyczny HTML z dnia scrapingu (bez JavaScriptu, więc sekcje zwinięte zostają
zwinięte, a skrypty strony nic nie robią) w trzech rozdzielczościach: komputer, tablet, telefon.
Arkusze CSS strona pobiera ze swojego adresu (`<base href>`), obrazy i filmy blokujemy.

- 7  dostępność za 1 kliknięciem: ostrzeżenie o ryzyku jest na stronie, ale schowane (zwinięta
     sekcja `<details>`, atrybut `hidden`, `display:none`, blok o wysokości 0) albo strona ma
     tylko link „Ostrzeżenie o ryzyku” do innej strony,
- 8  responsywność: na którymś ekranie ostrzeżenie jest ukryte, ucięte (wielokropek, line-clamp,
     poza ekranem) albo ma czcionkę poniżej 12 px po przeskalowaniu strony (telefon bez
     `<meta name="viewport">` pokazuje stronę w szerokości 980 px pomniejszoną do ekranu).

Ostrzeżenia rozpoznajemy tymi samymi frazami co w tekście i na klatkach (`risk_visual.is_warning`).
Pomiary (`measure`) wymagają przeglądarki; decyzje (`rule_7`, `rule_8`) to czyste funkcje.
"""

import re
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal

from ml.risk import Finding
from ml.risk_visual import QUOTE_MAX, is_warning
from ml.scraper import proxy_from_env

WEB_RULES: tuple[str, ...] = ("7", "8")

# (nazwa, szerokość, wysokość, urządzenie mobilne) — viewport w px CSS.
VIEWPORTS: tuple[tuple[str, int, int, bool], ...] = (
    ("komputer", 1280, 800, False),
    ("tablet", 768, 1024, True),
    ("telefon", 375, 812, True),
)
DESKTOP = VIEWPORTS[0][0]
READABLE_MIN_PX = 12.0  # reguła 8: najmniejsza czytelna czcionka ostrzeżenia na ekranie
RENDER_TIMEOUT_MS = 15_000
_BLOCKED_RESOURCES = frozenset({"image", "media"})

HiddenBy = Literal["details", "hidden", "css", "aria", "size", "collapsed"]

_HIDDEN_LABELS: dict[str, tuple[str, float]] = {
    "details": ("w zwiniętej sekcji (<details>), widoczne dopiero po rozwinięciu", 0.85),
    "hidden": ("w elemencie z atrybutem hidden (np. zakładka albo okno po kliknięciu)", 0.85),
    "collapsed": ("w zwiniętym bloku o wysokości 0 (akordeon), widoczne po rozwinięciu", 0.85),
    "css": ("ukryte stylem CSS (display:none, visibility:hidden albo przezroczystość)", 0.7),
    "aria": ("oznaczone aria-hidden, schowane przed czytnikami i zwykle przed widzem", 0.7),
    "size": ("w elemencie o zerowym rozmiarze", 0.7),
}


@dataclass(frozen=True)
class View:
    """Pomiar bloku tekstu w jednej rozdzielczości."""

    hidden_by: HiddenBy | None  # dlaczego blok jest niewidoczny; None = blok widoczny
    shown: str  # tekst, który widać (innerText: bez schowanych dzieci, np. zamkniętego <details>)
    font_px: float  # rozmiar czcionki na ekranie, po skalowaniu strony
    cut: bool  # tekst ucięty: wielokropek, line-clamp albo poza ekranem


@dataclass(frozen=True)
class Block:
    text: str  # cały tekst bloku (textContent), także schowany
    views: dict[str, View]  # nazwa ekranu -> pomiar


@dataclass(frozen=True)
class RiskLink:
    text: str
    href: str


@dataclass(frozen=True)
class PageRender:
    blocks: list[Block]
    links: list[RiskLink]


# ─── Pomiar w przeglądarce ──────────────────────────────────────────────────────────────────

# Bloki z tekstem o ryzyku (wstępny filtr, dokładne frazy sprawdza Python) i linki do ostrzeżeń.
# Ten sam DOM w każdej rozdzielczości (bez JavaScriptu), więc kolejność bloków jest ta sama.
# Bloki się zagnieżdżają (<span> z <b> w środku): widoczność ocenia `shown`, czyli innerText,
# który pomija schowane dzieci, a rozmiar czcionki — najgłębszy blok z ostrzeżeniem.
_MEASURE_JS = r"""
({ vw }) => {
  const PREFILTER = /ryzyk|risk|strat|traci|utrat|lose|losing/i;
  const LINK = new RegExp(
    "ostrze[żz]eni\\p{L}* o ryzyk|informacj\\p{L}* o ryzyk|ryzyk\\p{L}* inwestycyjn|" +
      "[śs]wiadomo[śs]ci[ _-]ryzyk|ujawnieni\\p{L}* ryzyk|risk[ _-](?:warning|disclosure)|" +
      "ostrze[żz]eni",
    "iu",
  );
  const BLOCKS = "p,li,div,span,small,td,th,dd,dt,section,article,aside,footer,summary,label," +
    "strong,em,b,i,h1,h2,h3,h4,h5,h6,blockquote,figcaption";
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const root = document.documentElement;
  const layoutWidth = Math.max(root.clientWidth || vw, 1);
  const scale = Math.min(1, vw / layoutWidth);
  const collapsedAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if ((s.overflowY === "hidden" || s.overflowY === "clip") && a.clientHeight < 2) return true;
    }
    return false;
  };
  const blocks = [];
  for (const el of document.body ? document.body.querySelectorAll(BLOCKS) : []) {
    const text = norm(el.textContent);
    if (text.length < 15 || text.length > 5000 || !PREFILTER.test(text)) continue;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const details = el.closest("details:not([open])");
    const summary = el.closest("summary");
    let hiddenBy = null;
    if (details && !(summary && summary.parentElement === details)) hiddenBy = "details";
    else if (el.closest("[hidden]")) hiddenBy = "hidden";
    else if (el.closest('[aria-hidden="true"]')) hiddenBy = "aria";
    else if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
      hiddenBy = "css";
    }
    else if (rect.width < 1 || rect.height < 1) hiddenBy = "size";
    else if (collapsedAncestor(el)) hiddenBy = "collapsed";
    const clamp = style.webkitLineClamp && style.webkitLineClamp !== "none";
    const cut =
      (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) ||
      (clamp && el.scrollHeight > el.clientHeight + 1) ||
      rect.right > layoutWidth + 2 ||
      rect.left < -2;
    const shown = hiddenBy === null ? norm(el.innerText) : "";
    const fontPx = parseFloat(style.fontSize) * scale;
    blocks.push({ text, shown, hidden_by: hiddenBy, font_px: fontPx, cut });
  }
  const links = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const text = norm(a.textContent);
    let href = a.href;
    try { href = decodeURI(href); } catch (e) {}
    if (text && text.length <= 200 && LINK.test(text + " " + href)) {
      links.push({ text, href: a.href });
    }
  }
  return { blocks, links };
}
"""

_BASE_RE = re.compile(r"<base\s", re.IGNORECASE)
_HEAD_RE = re.compile(r"<head(?:\s[^>]*)?>", re.IGNORECASE)
# Bez JavaScriptu stronę może jeszcze przenieść <meta http-equiv="refresh"> — wycinamy go.
_REFRESH_RE = re.compile(r"<meta[^>]+http-equiv\s*=\s*[\"']?refresh[^>]*>", re.IGNORECASE)


def with_base(html: str, url: str) -> str:
    """Bez przekierowania meta refresh i z `<base href>` adresu strony (względne arkusze CSS)."""
    html = _REFRESH_RE.sub("", html)
    if _BASE_RE.search(html):
        return html
    tag = f'<base href="{url.replace(chr(34), "%22")}">'
    head = _HEAD_RE.search(html)
    return f"{html[: head.end()]}{tag}{html[head.end() :]}" if head else f"{tag}{html}"


def measure(html: str, url: str) -> PageRender:
    """Renderuje HTML w Chromium (bez JS) w każdej rozdzielczości z `VIEWPORTS`."""
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import Route, sync_playwright

    def block_heavy(route: Route) -> None:
        if route.request.resource_type in _BLOCKED_RESOURCES:
            route.abort()
        else:
            route.continue_()

    content = with_base(html, url)
    raw: dict[str, dict[str, Any]] = {}
    proxy = proxy_from_env()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(proxy={"server": proxy} if proxy else None)
        try:
            for name, width, height, mobile in VIEWPORTS:
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    is_mobile=mobile,
                    has_touch=mobile,
                    java_script_enabled=False,
                )
                try:
                    page = context.new_page()
                    page.route("**/*", block_heavy)
                    # Wolny arkusz CSS albo czcionka: po czasie mierzymy to, co się wczytało.
                    with suppress(PlaywrightError):
                        page.set_content(content, wait_until="load", timeout=RENDER_TIMEOUT_MS)
                    raw[name] = page.evaluate(_MEASURE_JS, {"vw": width})
                finally:
                    context.close()
        finally:
            browser.close()
    return _parse(raw)


def _parse(raw: dict[str, dict[str, Any]]) -> PageRender:
    desktop = raw.get(DESKTOP, {})
    blocks: list[Block] = []
    for index, item in enumerate(desktop.get("blocks", [])):
        views: dict[str, View] = {}
        for name, data in raw.items():
            items = data.get("blocks", [])
            if index < len(items):
                b = items[index]
                views[name] = View(
                    b.get("hidden_by"),
                    str(b.get("shown") or ""),
                    float(b.get("font_px") or 0),
                    bool(b.get("cut")),
                )
        blocks.append(Block(str(item["text"]), views))
    links = [RiskLink(str(x["text"]), str(x["href"])) for x in desktop.get("links", [])]
    return PageRender(blocks, links)


# ─── Reguły ─────────────────────────────────────────────────────────────────────────────────


def _shown_warnings(render: PageRender, screen: str) -> list[tuple[Block, View]]:
    """Bloki, w których na ekranie `screen` widać ostrzeżenie; najgłębsze (najkrótsze) pierwsze."""
    found = [
        (b, v)
        for b in render.blocks
        if (v := b.views.get(screen)) is not None and v.hidden_by is None and is_warning(v.shown)
    ]
    return sorted(found, key=lambda item: len(item[1].shown))


def _confidence(distance: float, scale: float) -> float:
    return round(min(0.95, 0.5 + 0.45 * min(1.0, abs(distance) / scale)), 3)


def rule_7(render: PageRender, text: str = "") -> Finding:
    """`text`: tekst materiału ze scrapingu. Gdy ma ostrzeżenie, którego render nie pokazał
    (strona budowana JavaScriptem), nie zgłaszamy naruszenia."""
    visible = _shown_warnings(render, DESKTOP)
    if visible:
        reason = "Ostrzeżenie o ryzyku jest widoczne na stronie bez klikania (komputer)."
        return Finding("7", "ok", 0.85, visible[0][1].shown[:QUOTE_MAX], reason)
    hidden = [
        b
        for b in render.blocks
        if is_warning(b.text) and (v := b.views.get(DESKTOP)) is not None and v.hidden_by
    ]
    if hidden:
        block = min(hidden, key=lambda b: len(b.text))  # najgłębszy schowany blok
        label, confidence = _HIDDEN_LABELS[block.views[DESKTOP].hidden_by or "css"]
        reason = f"Ostrzeżenie o ryzyku jest na stronie, ale schowane: {label}."
        return Finding("7", "violation", confidence, block.text[:QUOTE_MAX], reason)
    if is_warning(text):
        reason = (
            "Ostrzeżenie o ryzyku jest w tekście strony, ale nie w renderze bez JavaScriptu "
            "(strona budowana skryptami), więc reguły nie oceniamy."
        )
        return Finding("7", "n/a", 0.0, None, reason)
    if render.links:
        link = render.links[0]
        reason = (
            f"Na stronie nie ma treści ostrzeżenia o ryzyku, jest tylko link „{link.text}” "
            f"({link.href}): widz musi przejść na inną stronę."
        )
        return Finding("7", "violation", 0.7, link.text[:QUOTE_MAX], reason)
    reason = "Strona nie zawiera ostrzeżenia o ryzyku (jego brak ocenia reguła 3)."
    return Finding("7", "n/a", 0.9, None, reason)


def rule_8(render: PageRender) -> Finding:
    desktop = _shown_warnings(render, DESKTOP)
    if not desktop:
        reason = "Brak widocznego ostrzeżenia o ryzyku (jego brak i ukrycie oceniają reguły 3 i 7)."
        return Finding("8", "n/a", 0.9, None, reason)
    problems: list[str] = []
    sizes: list[str] = []
    distances: list[float] = []
    for name, *_ in VIEWPORTS:
        shown = _shown_warnings(render, name)
        if not shown:
            problems.append(f"{name}: ostrzeżenie ukryte")
            sizes.append(f"{name} ukryte")
            distances.append(-READABLE_MIN_PX)
            continue
        whole = [v for _, v in shown if not v.cut]
        best = (whole or [v for _, v in shown])[0]  # najgłębszy blok = faktyczna czcionka
        sizes.append(f"{name} {best.font_px:.0f} px")
        distances.append(best.font_px - READABLE_MIN_PX)
        if not whole:
            problems.append(f"{name}: tekst ucięty")
        if best.font_px < READABLE_MIN_PX:
            problems.append(f"{name}: czcionka {best.font_px:.0f} px")
    quote = desktop[0][1].shown[:QUOTE_MAX]
    listed = ", ".join(sizes)
    if problems:
        reason = (
            f"Ostrzeżenie o ryzyku nieczytelne na części ekranów ({'; '.join(problems)}). "
            f"Czcionka ostrzeżenia: {listed} (minimum {READABLE_MIN_PX:g} px)."
        )
        worst = min(distances)
        confidence = _confidence(worst, READABLE_MIN_PX / 2) if worst < 0 else 0.8
        return Finding("8", "violation", confidence, quote, reason)
    reason = (
        f"Ostrzeżenie o ryzyku czytelne na komputerze, tablecie i telefonie: {listed} "
        f"(minimum {READABLE_MIN_PX:g} px)."
    )
    return Finding("8", "ok", _confidence(min(distances), READABLE_MIN_PX / 2), quote, reason)


def evaluate(render: PageRender, rules: list[str] | None = None, text: str = "") -> list[Finding]:
    """Reguły 7 i 8 z pomiarów strony. `text`: tekst materiału (patrz `rule_7`)."""
    findings: list[Finding] = []
    if rules is None or "7" in rules:
        findings.append(rule_7(render, text))
    if rules is None or "8" in rules:
        findings.append(rule_8(render))
    return findings


def not_rendered(reason: str, rules: list[str] | None = None) -> list[Finding]:
    """Reguły 7 i 8 jako `n/a`, gdy strony nie udało się wyrenderować."""
    return [Finding(r, "n/a", 0.0, None, reason) for r in WEB_RULES if rules is None or r in rules]
