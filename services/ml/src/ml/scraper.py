"""Uniwersalny scraper stron WWW: pobranie (httpx), ekstrakcja tekstu z HTML, hash do deduplikacji.

Bezstanowy — nic nie zapisuje do bazy. Zapis do tabel `materials` / `scrape_jobs` robi wołający
(backend Next.js), bo serwis ML nie ma dostępu do bazy.
"""

import hashlib
import os
import random
import re
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit

import httpx
from selectolax.lexbor import LexborHTMLParser, LexborNode

# Popularne przeglądarki desktop/mobile — losujemy jedną na żądanie.
USER_AGENTS: tuple[str, ...] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Mobile Safari/537.36",
)

# Elementy bez treści merytorycznej (nawigacja, skrypty, stopki, formularze).
_NOISE_SELECTORS = (
    "script, style, noscript, template, svg, iframe, canvas, form, button, "
    'nav, header, footer, aside, [aria-hidden="true"], [role="navigation"]'
)
_MAIN_SELECTORS = ("article", "main", "[role=main]")
_BLOCK_TAGS = (
    "p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article, blockquote, pre, td, th"
)

DEFAULT_TIMEOUT = 15.0
MAX_BYTES = 5_000_000
MAX_LINKS = 100


class ScrapeError(Exception):
    """Strony nie udało się pobrać albo nie jest HTML-em."""


@dataclass(frozen=True)
class Extracted:
    title: str | None
    text: str
    language: str | None
    author: str | None
    description: str | None


@dataclass(frozen=True)
class ScrapedPage:
    url: str
    final_url: str
    status_code: int
    title: str | None
    text: str
    content_hash: str
    language: str | None
    author: str | None
    description: str | None
    user_agent: str
    fetched_at: datetime
    html: str
    links: tuple[str, ...] = ()


def pick_user_agent(rng: random.Random | None = None) -> str:
    return (rng or random).choice(USER_AGENTS)


def proxy_from_env() -> str | None:
    """Opcjonalny proxy dla scrapera, np. http://user:pass@host:port. Puste = bez proxy."""
    return os.environ.get("SCRAPER_PROXY_URL") or None


def normalize_text(text: str) -> str:
    """NFC, jedna spacja zamiast ciągów białych znaków, max jedna pusta linia między akapitami."""
    text = unicodedata.normalize("NFC", text).replace("\xa0", " ")
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    joined = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", joined).strip()


def content_hash(text: str) -> str:
    """SHA-256 tekstu po normalizacji i lowercase — ta sama treść pod innym URL = ten sam hash."""
    canonical = re.sub(r"\s+", " ", normalize_text(text)).lower()
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _meta(tree: LexborHTMLParser, *selectors: str) -> str | None:
    for selector in selectors:
        node = tree.css_first(selector)
        if node is not None:
            value = (node.attributes.get("content") or "").strip()
            if value:
                return value
    return None


# Znacznik końca bloku (znak z obszaru prywatnego Unicode — nie występuje w normalnym tekście).
_BLOCK_BREAK = "\ue000"


def _node_text(node: LexborNode) -> str:
    """Tekst węzła: białe znaki zwijamy jak przeglądarka, granice bloków = nowe linie."""
    for block in node.css(_BLOCK_TAGS):
        block.insert_after(_BLOCK_BREAK)
    raw = unicodedata.normalize("NFC", node.text(separator="", deep=True)).replace("\xa0", " ")
    lines = (re.sub(r"\s+", " ", part).strip() for part in raw.split(_BLOCK_BREAK))
    return "\n".join(line for line in lines if line)


def extract(html: str) -> Extracted:
    """Wyciąga tytuł, główny tekst i metadane z HTML-a."""
    tree = LexborHTMLParser(html)

    title_node = tree.css_first("title")
    title = _meta(tree, 'meta[property="og:title"]') or (
        title_node.text(strip=True) if title_node is not None else None
    )
    description = _meta(tree, 'meta[name="description"]', 'meta[property="og:description"]')
    author = _meta(tree, 'meta[name="author"]', 'meta[property="article:author"]')
    html_node = tree.css_first("html")
    language = (html_node.attributes.get("lang") or None) if html_node is not None else None

    # Od końca: dzieci przed rodzicami, żeby nie usuwać węzła z już usuniętego poddrzewa.
    for node in reversed(tree.css(_NOISE_SELECTORS)):
        node.decompose()

    root: LexborNode | None = None
    for selector in _MAIN_SELECTORS:
        root = tree.css_first(selector)
        if root is not None:
            break
    root = root or tree.body or tree.root

    text = normalize_text(_node_text(root)) if root is not None else ""
    return Extracted(
        title=normalize_text(title) if title else None,
        text=text,
        language=language.strip().lower() if language else None,
        author=author,
        description=description,
    )


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def extract_links(html: str, base_url: str) -> tuple[str, ...]:
    """Linki wychodzące (http/https, inna domena niż strona) — moduł 1 szuka w nich firmy
    inwestycyjnej reklamowanej przez stronę trzecią (link afiliacyjny, polecający)."""
    own = _host(base_url)
    found: dict[str, None] = {}
    for node in LexborHTMLParser(html).css("a[href]"):
        href = (node.attributes.get("href") or "").strip()
        url = urljoin(base_url, href).split("#", 1)[0]
        host = _host(url)
        if urlsplit(url).scheme in ("http", "https") and "." in host and host != own:
            found[url] = None
            if len(found) >= MAX_LINKS:
                break
    return tuple(found)


def scrape(
    url: str,
    *,
    client: httpx.Client | None = None,
    proxy: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    rng: random.Random | None = None,
) -> ScrapedPage:
    """Pobiera stronę i zwraca wyekstrahowaną treść. `client` podmieniamy w testach."""
    user_agent = pick_user_agent(rng)
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7",
    }
    own_client = client is None
    http = client or httpx.Client(
        proxy=proxy if proxy is not None else proxy_from_env(),
        timeout=timeout,
        follow_redirects=True,
    )
    try:
        response = http.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise ScrapeError(f"Nie udało się pobrać {url}: {exc}") from exc
    except (httpx.InvalidURL, UnicodeError) as exc:
        # Adres, którego nie da się otworzyć (np. niewidoczny znak w domenie z opisu filmu) —
        # błąd tego jednego linku, nie całego zbierania.
        raise ScrapeError(f"Nieprawidłowy adres {url!r}: {exc}") from exc
    finally:
        if own_client:
            http.close()

    if response.status_code >= 400:
        raise ScrapeError(f"{url} zwrócił HTTP {response.status_code}")
    content_type = response.headers.get("content-type", "")
    if content_type and "html" not in content_type and "xml" not in content_type:
        raise ScrapeError(f"{url} to nie HTML ({content_type})")
    if len(response.content) > MAX_BYTES:
        raise ScrapeError(f"{url} ma ponad {MAX_BYTES} bajtów")

    html = response.text
    extracted = extract(html)
    return ScrapedPage(
        url=url,
        final_url=str(response.url),
        status_code=response.status_code,
        title=extracted.title,
        text=extracted.text,
        content_hash=content_hash(extracted.text),
        language=extracted.language,
        author=extracted.author,
        description=extracted.description,
        user_agent=user_agent,
        fetched_at=datetime.now(UTC),
        html=html,
        links=extract_links(html, str(response.url)),
    )
