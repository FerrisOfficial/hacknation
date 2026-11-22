"""Kolektor YouTube: wyszukiwanie filmów, etykieta płatnej promocji, transkrypcja i linki z opisu.

Zbiera wyłącznie tekst — nie pobiera wideo ani audio (yt-dlp tylko listuje wyniki wyszukiwania).

- wyszukiwanie: yt-dlp (opcjonalnie z filtrem YouTube „Zawiera płatną promocję”),
- metadane i etykieta: `ytInitialPlayerResponse` ze strony filmu (yt-dlp etykiety nie zwraca),
- transkrypcja: youtube-transcript-api (napisy ze strony filmu wymagają tokenu PO),
- strony, do których prowadzą linki z opisu: scraper WWW z `ml.scraper`.

Bezstanowy jak scraper WWW — zapis do bazy robi wołający.
"""

import json
import os
import random
import re
import time
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlencode, urlsplit

import httpx
from youtube_transcript_api import YouTubeTranscriptApi, YouTubeTranscriptApiException
from youtube_transcript_api.proxies import GenericProxyConfig
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from ml.scraper import (
    DEFAULT_TIMEOUT,
    USER_AGENTS,
    ScrapeError,
    content_hash,
    normalize_text,
    proxy_from_env,
    scrape,
)

SEARCH_URL = "https://www.youtube.com/results"
WATCH_URL = "https://www.youtube.com/watch?v={video_id}"

# Parametr `sp` wyszukiwarki = filtr „Zawiera płatną promocję”. Na ten adres prowadzi link
# „Poznaj płatne promocje w YouTube” z Google Ads Transparency Center.
PAID_PROMOTION_FILTER = "EgOAAgE="

# Strona filmu z mobilnym User-Agentem przekierowuje na m.youtube.com (inny format danych).
DESKTOP_USER_AGENTS: tuple[str, ...] = tuple(ua for ua in USER_AGENTS if "Mobile" not in ua)
# Ciasteczko zgody (jak w yt-dlp) — bez niego część żądań z UE ląduje na consent.youtube.com.
_CONSENT_COOKIE = "SOCS=CAI"

# Linki do innych filmów z YouTube pomijamy całkiem (szum w opisach).
_YOUTUBE_DOMAINS = ("youtube.com", "youtu.be")
# Linki do profili i platform twórcy (nie oferty) — zapisujemy, ale ich nie pobieramy.
_NOT_FOLLOWED_DOMAINS = (
    *_YOUTUBE_DOMAINS,
    "instagram.com",
    "facebook.com",
    "fb.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
    "threads.net",
    "linkedin.com",
    "discord.gg",
    "discord.com",
    "t.me",
    "telegram.me",
    "spotify.com",
    "apple.com",
    "patreon.com",
    "patronite.pl",
)

MAX_LINKED_TEXT = 20_000
TRANSCRIPT_LANGUAGES = ("pl", "en")
MAX_WORKERS = 4  # strony z linków w opisie (inne domeny niż YouTube)
DEFAULT_YOUTUBE_DELAY_S = 3.0

_VIDEO_ID_RE = re.compile(r"^[\w-]{11}$")
_PLAYER_RESPONSE_RE = re.compile(r"ytInitialPlayerResponse\s*=\s*")
# Niewidoczne znaki (zero-width space, znaki kierunku tekstu, BOM) kończą adres jak spacja —
# twórcy wklejają je za linkiem, a `\s` ich nie łapie („…xtb.pl​/kod”).
_URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s<>\"'()\[\]{}​-‏‪-‮⁠-⁤﻿]+",
    re.IGNORECASE,
)
_URL_TRAILING = ".,;:!?…»”'\""
# „kod promocyjny: "ABC123"”, „z kodem ABC123” — sam kod wielkimi literami (z cyframi).
_PROMO_CODE_RE = re.compile(
    r"(?i:\bkod(?:em|u)?(?:\s+(?:promocyjn|polecając|rabatow|zniżkow|partnersk)\w*)?)"
    r"\s*[:\-\N{EN DASH}]?\s*[\"„“'”]?((?=[A-Z0-9_-]*[A-Z])[A-Z0-9][A-Z0-9_-]{2,29})\b"
)

type Json = dict[str, Json] | list[Json] | str | int | float | bool | None


class YoutubeError(Exception):
    """Nie udało się wyszukać filmów albo odczytać strony filmu."""


class TranscriptUnavailable(Exception):
    """Film nie ma transkrypcji w żądanym języku albo YouTube jej nie wydał."""


@dataclass(frozen=True)
class SearchHit:
    video_id: str
    title: str | None
    channel: str | None


@dataclass(frozen=True)
class VideoPage:
    video_id: str
    title: str
    description: str
    channel: str | None
    channel_id: str | None
    channel_url: str | None
    published_at: datetime | None
    duration_s: int | None
    view_count: int | None
    category: str | None
    keywords: tuple[str, ...]
    is_unlisted: bool
    paid_promotion: bool


@dataclass(frozen=True)
class TranscriptSegment:
    start: float
    text: str


@dataclass(frozen=True)
class Transcript:
    language: str
    is_generated: bool
    segments: tuple[TranscriptSegment, ...]

    @property
    def text(self) -> str:
        return normalize_text(" ".join(segment.text for segment in self.segments))


@dataclass(frozen=True)
class LinkedPage:
    url: str
    domain: str
    followed: bool
    final_url: str | None = None
    final_domain: str | None = None
    title: str | None = None
    text: str | None = None
    content_hash: str | None = None
    error: str | None = None
    # Surowy HTML z dnia pobrania — kopia strony do Okna sprawy i reguł M2 dla stron WWW (R4).
    html: str | None = None


@dataclass(frozen=True)
class CollectedVideo:
    video_id: str
    url: str
    title: str
    description: str
    channel: str | None
    channel_id: str | None
    channel_url: str | None
    published_at: datetime | None
    duration_s: int | None
    view_count: int | None
    category: str | None
    keywords: tuple[str, ...]
    is_unlisted: bool
    paid_promotion: bool
    transcript: Transcript | None
    transcript_error: str | None
    links: tuple[LinkedPage, ...]
    promo_codes: tuple[str, ...]
    text: str
    content_hash: str


@dataclass(frozen=True)
class FailedVideo:
    video_id: str
    error: str


@dataclass(frozen=True)
class Collection:
    query: str
    paid_only: bool
    videos: tuple[CollectedVideo, ...]
    failed: tuple[FailedVideo, ...]


type Searcher = Callable[[str, int, bool], list[SearchHit]]
type TranscriptFetcher = Callable[[str], Transcript]
type PageScraper = Callable[[str], LinkedPage]


# ─── Wyszukiwanie ───────────────────────────────────────────────────────────────────────────────


def search_url(query: str, *, paid_only: bool) -> str:
    params = {"search_query": query}
    if paid_only:
        params["sp"] = PAID_PROMOTION_FILTER
    return f"{SEARCH_URL}?{urlencode(params)}"


def search_videos(query: str, limit: int, paid_only: bool) -> list[SearchHit]:
    """Pierwsze `limit` filmów z wyników wyszukiwania (bez kanałów i playlist).

    `extract_flat` + `download=False`: yt-dlp tylko listuje wyniki, nie pobiera wideo.
    """
    try:
        with YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": "in_playlist",
                "playlistend": limit,
                "http_headers": {
                    "User-Agent": random.choice(DESKTOP_USER_AGENTS),
                    "Accept-Language": "pl-PL,pl;q=0.9",
                },
                "proxy": proxy_from_env(),  # None = bez proxy
            }
        ) as ydl:
            info: object = ydl.extract_info(search_url(query, paid_only=paid_only), download=False)
    except DownloadError as exc:
        raise YoutubeError(f"Wyszukiwanie w YouTube nie powiodło się: {exc}") from exc

    return _hits(info, limit)


def _hits(info: object, limit: int) -> list[SearchHit]:
    """Filmy z płaskiej listy yt-dlp (wyniki wyszukiwania, zakładka kanału)."""
    entries = info.get("entries") if isinstance(info, dict) else None
    hits: list[SearchHit] = []
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or entry.get("ie_key") not in (None, "Youtube"):
            continue
        video_id = entry.get("id")
        if isinstance(video_id, str) and _VIDEO_ID_RE.match(video_id):
            title = entry.get("title")
            channel = entry.get("channel")
            hits.append(
                SearchHit(
                    video_id=video_id,
                    title=title if isinstance(title, str) else None,
                    channel=channel if isinstance(channel, str) else None,
                )
            )
    return hits[:limit]


_CHANNEL_URL_RE = re.compile(
    # Handle z polską literą bywa zakodowany: „@MarcinIwu%C4%87FBO”.
    r"^https://(?:www\.|m\.)?youtube\.com/(?:@(?:[\w.\-]|%[0-9A-Fa-f]{2})+|channel/UC[\w-]{22}|c/[\w.\-]+|user/[\w.\-]+)"
)


def channel_videos_url(channel_url: str) -> str:
    """Zakładka „Filmy” kanału (bez Shorts i transmisji). ValueError dla adresu spoza YouTube."""
    match = _CHANNEL_URL_RE.match(channel_url.strip())
    if match is None:
        raise ValueError(f"To nie jest adres kanału YouTube: {channel_url}")
    return f"{match.group(0).replace('://m.', '://www.')}/videos"


def channel_videos(channel_url: str, limit: int) -> list[SearchHit]:
    """Najnowsze `limit` filmów kanału — moduł 1 obserwuje kanały, w których znalazł reklamę."""
    try:
        with YoutubeDL(
            {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": "in_playlist",
                "playlistend": limit,
                "http_headers": {
                    "User-Agent": random.choice(DESKTOP_USER_AGENTS),
                    "Accept-Language": "pl-PL,pl;q=0.9",
                },
                "proxy": proxy_from_env(),
            }
        ) as ydl:
            info: object = ydl.extract_info(channel_videos_url(channel_url), download=False)
    except DownloadError as exc:
        raise YoutubeError(f"Nie udało się pobrać listy filmów kanału: {exc}") from exc
    return _hits(info, limit)


# ─── Strona filmu ───────────────────────────────────────────────────────────────────────────────


def _dig(node: Json, *path: str) -> Json:
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _as_str(node: Json) -> str | None:
    return node if isinstance(node, str) and node else None


def _as_int(node: Json) -> int | None:
    if isinstance(node, bool):
        return None
    if isinstance(node, int):
        return node
    if isinstance(node, str) and node.isdigit():
        return int(node)
    return None


def _as_datetime(node: Json) -> datetime | None:
    value = _as_str(node)
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def player_response(html: str) -> dict[str, Json]:
    """`ytInitialPlayerResponse` ze strony filmu (JSON w tagu <script>)."""
    match = _PLAYER_RESPONSE_RE.search(html)
    if match is None:
        raise YoutubeError("Na stronie nie ma danych filmu (strona zgody, blokada albo zły ID)")
    try:
        data, _ = json.JSONDecoder().raw_decode(html, match.end())
    except json.JSONDecodeError as exc:
        raise YoutubeError("Nie udało się odczytać danych filmu") from exc
    if not isinstance(data, dict):
        raise YoutubeError("Nieoczekiwany format danych filmu")
    return data


def parse_watch_page(html: str, video_id: str) -> VideoPage:
    player = player_response(html)
    status = _as_str(_dig(player, "playabilityStatus", "status"))
    details = _dig(player, "videoDetails")
    if not isinstance(details, dict) or status not in (None, "OK"):
        reason = _as_str(_dig(player, "playabilityStatus", "reason")) or status
        raise YoutubeError(f"Film {video_id} niedostępny: {reason}")
    micro = _dig(player, "microformat", "playerMicroformatRenderer")

    channel_id = _as_str(details.get("channelId"))
    channel_url = _as_str(_dig(micro, "ownerProfileUrl"))
    if channel_url:
        channel_url = re.sub(r"^http://", "https://", channel_url)
    elif channel_id:
        channel_url = f"https://www.youtube.com/channel/{channel_id}"
    keywords = details.get("keywords")

    return VideoPage(
        video_id=video_id,
        title=_as_str(details.get("title")) or "",
        description=_as_str(details.get("shortDescription")) or "",
        channel=_as_str(details.get("author")) or _as_str(_dig(micro, "ownerChannelName")),
        channel_id=channel_id,
        channel_url=channel_url,
        published_at=_as_datetime(_dig(micro, "publishDate")),
        duration_s=_as_int(details.get("lengthSeconds")),
        view_count=_as_int(details.get("viewCount")),
        category=_as_str(_dig(micro, "category")),
        keywords=tuple(k for k in keywords if isinstance(k, str))
        if isinstance(keywords, list)
        else (),
        is_unlisted=_dig(micro, "isUnlisted") is True,
        # Etykieta „Zawiera płatną promocję” — twórca sam ją zaznacza w YouTube Studio.
        paid_promotion=_dig(player, "paidContentOverlay", "paidContentOverlayRenderer") is not None,
    )


def fetch_video_page(video_id: str, *, client: httpx.Client) -> VideoPage:
    headers = {
        "User-Agent": random.choice(DESKTOP_USER_AGENTS),
        "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7",
        "Cookie": _CONSENT_COOKIE,
    }
    try:
        response = client.get(WATCH_URL.format(video_id=video_id), headers=headers)
    except httpx.HTTPError as exc:
        raise YoutubeError(f"Nie udało się pobrać strony filmu {video_id}: {exc}") from exc
    if response.status_code >= 400:
        raise YoutubeError(f"Strona filmu {video_id} zwróciła HTTP {response.status_code}")
    return parse_watch_page(response.text, video_id)


# ─── Transkrypcja ───────────────────────────────────────────────────────────────────────────────


def fetch_transcript(video_id: str, languages: Sequence[str] = TRANSCRIPT_LANGUAGES) -> Transcript:
    proxy = proxy_from_env()
    api = YouTubeTranscriptApi(
        proxy_config=GenericProxyConfig(http_url=proxy, https_url=proxy) if proxy else None
    )
    try:
        fetched = api.fetch(video_id, languages=list(languages))
    # requests (pod spodem biblioteki) zgłasza błędy sieci jako OSError.
    except (YouTubeTranscriptApiException, OSError) as exc:
        raise TranscriptUnavailable(type(exc).__name__) from exc
    return Transcript(
        language=fetched.language_code,
        is_generated=fetched.is_generated,
        segments=tuple(
            TranscriptSegment(start=snippet.start, text=snippet.text.strip())
            for snippet in fetched.snippets
            if snippet.text.strip()
        ),
    )


# ─── Opis: linki i kody promocyjne ──────────────────────────────────────────────────────────────


def extract_links(text: str) -> list[str]:
    """Adresy z tekstu w kolejności wystąpienia, bez duplikatów. `www.x.pl` → `https://www.x.pl`."""
    links: dict[str, None] = {}
    for match in _URL_RE.finditer(text):
        url = match.group(0).rstrip(_URL_TRAILING)
        if url.lower().startswith("www."):
            url = f"https://{url}"
        if urlsplit(url).hostname:
            links[url] = None
    return list(links)


def extract_promo_codes(text: str) -> list[str]:
    return list(dict.fromkeys(match.group(1) for match in _PROMO_CODE_RE.finditer(text)))


def domain_of(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.")


def _in_domains(url: str, domains: Iterable[str]) -> bool:
    domain = domain_of(url)
    return any(domain == other or domain.endswith(f".{other}") for other in domains)


def is_followable(url: str) -> bool:
    """Czy pobierać stronę: tak dla ofert i landing page'y, nie dla social mediów twórcy."""
    return bool(domain_of(url)) and not _in_domains(url, _NOT_FOLLOWED_DOMAINS)


def description_links(description: str) -> list[str]:
    """Linki z opisu bez odnośników do innych filmów z YouTube."""
    return [url for url in extract_links(description) if not _in_domains(url, _YOUTUBE_DOMAINS)]


def scrape_linked_page(url: str, *, client: httpx.Client) -> LinkedPage:
    domain = domain_of(url)
    try:
        page = scrape(url, client=client)
    except ScrapeError as exc:
        return LinkedPage(url=url, domain=domain, followed=True, error=str(exc))
    return LinkedPage(
        url=url,
        domain=domain,
        followed=True,
        final_url=page.final_url,
        final_domain=domain_of(page.final_url),
        title=page.title,
        text=page.text[:MAX_LINKED_TEXT],
        content_hash=page.content_hash,
        html=page.html,
    )


# ─── Całość ─────────────────────────────────────────────────────────────────────────────────────


def _analysis_text(title: str, description: str, transcript: Transcript | None) -> str:
    """Tekst dla modułów AI: tytuł, opis i transkrypcja."""
    parts = (title, description, transcript.text if transcript else "")
    return normalize_text("\n\n".join(part for part in parts if part))


def youtube_delay_s() -> float:
    """Przerwa przed każdym zapytaniem do YouTube (`YOUTUBE_DELAY_S`, domyślnie 3 s, 0 = bez).

    Kilkadziesiąt zapytań na minutę z jednego IP kończy się HTTP 429 na kilkadziesiąt minut.
    """
    try:
        return max(0.0, float(os.environ.get("YOUTUBE_DELAY_S", DEFAULT_YOUTUBE_DELAY_S)))
    except ValueError:
        return DEFAULT_YOUTUBE_DELAY_S


def _pause(delay_s: float) -> None:
    # Losowy rozrzut ±50% — równe odstępy wyglądają jak bot.
    if delay_s > 0:
        time.sleep(delay_s * random.uniform(0.5, 1.5))


def _video_and_transcript(
    hit: SearchHit,
    *,
    client: httpx.Client,
    transcript_fetcher: TranscriptFetcher | None,
    delay_s: float,
) -> tuple[VideoPage, Transcript | None, str | None] | FailedVideo:
    _pause(delay_s)
    try:
        page = fetch_video_page(hit.video_id, client=client)
    except YoutubeError as exc:
        return FailedVideo(video_id=hit.video_id, error=str(exc))
    if transcript_fetcher is None:
        return page, None, None
    _pause(delay_s)
    try:
        return page, transcript_fetcher(hit.video_id), None
    except TranscriptUnavailable as exc:
        return page, None, str(exc)


def _videos_one_by_one(
    hits: Sequence[SearchHit],
    *,
    client: httpx.Client,
    transcript_fetcher: TranscriptFetcher | None,
    delay_s: float,
) -> list[tuple[VideoPage, Transcript | None, str | None] | FailedVideo]:
    """Filmy po kolei, z przerwami. Po pierwszym HTTP 429 dalsze zapytania tylko przedłużają
    blokadę — reszta filmów czeka na następne uruchomienie źródła."""
    fetched: list[tuple[VideoPage, Transcript | None, str | None] | FailedVideo] = []
    for hit in hits:
        item = _video_and_transcript(
            hit, client=client, transcript_fetcher=transcript_fetcher, delay_s=delay_s
        )
        fetched.append(item)
        if isinstance(item, FailedVideo) and "HTTP 429" in item.error:
            break
    return fetched


def _map[T, R](fn: Callable[[T], R], items: Iterable[T]) -> list[R]:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        return list(pool.map(fn, items))


def collect(
    query: str,
    *,
    limit: int = 10,
    paid_only: bool = True,
    transcripts: bool = True,
    follow_links: bool = True,
    max_links_per_video: int = 5,
    client: httpx.Client | None = None,
    searcher: Searcher | None = None,
    transcript_fetcher: TranscriptFetcher | None = None,
    delay_s: float | None = None,
) -> Collection:
    """Wyszukuje filmy i zbiera dla każdego metadane, etykietę, transkrypcję i strony z opisu.

    Do YouTube po kolei, z przerwą `delay_s` (domyślnie `YOUTUBE_DELAY_S`); strony z linków
    w opisie (inne domeny) równolegle. `client`, `searcher` i `transcript_fetcher` podmieniamy
    w testach (bez sieci).
    """
    hits = (searcher or search_videos)(query, limit, paid_only)
    fetch_text = (transcript_fetcher or fetch_transcript) if transcripts else None

    own_client = client is None
    http = client or httpx.Client(
        proxy=proxy_from_env(), timeout=DEFAULT_TIMEOUT, follow_redirects=True
    )
    try:
        fetched = _videos_one_by_one(
            hits,
            client=http,
            transcript_fetcher=fetch_text,
            delay_s=youtube_delay_s() if delay_s is None else delay_s,
        )
        pages = [item for item in fetched if not isinstance(item, FailedVideo)]
        failed = tuple(item for item in fetched if isinstance(item, FailedVideo))
        if not pages and failed and all("HTTP 429" in item.error for item in failed):
            # Blokada YouTube, a nie brak filmów: zadanie kończy się błędem, nie pustym wynikiem.
            raise YoutubeError(
                "YouTube ogranicza zapytania (HTTP 429). "
                "Spróbuj później albo ustaw SCRAPER_PROXY_URL."
            )

        # Ten sam link (np. afiliacyjny) w wielu filmach pobieramy raz.
        links_per_video = [description_links(page.description) for page, _, _ in pages]
        to_follow: dict[str, None] = {}
        if follow_links:
            for links in links_per_video:
                for url in [url for url in links if is_followable(url)][:max_links_per_video]:
                    to_follow[url] = None
        scraped = dict(
            zip(
                to_follow,
                _map(lambda url: scrape_linked_page(url, client=http), to_follow),
                strict=True,
            )
        )
    finally:
        if own_client:
            http.close()

    videos: list[CollectedVideo] = []
    for (page, transcript, transcript_error), links in zip(pages, links_per_video, strict=True):
        text = _analysis_text(page.title, page.description, transcript)
        videos.append(
            CollectedVideo(
                video_id=page.video_id,
                url=WATCH_URL.format(video_id=page.video_id),
                title=page.title,
                description=page.description,
                channel=page.channel,
                channel_id=page.channel_id,
                channel_url=page.channel_url,
                published_at=page.published_at,
                duration_s=page.duration_s,
                view_count=page.view_count,
                category=page.category,
                keywords=page.keywords,
                is_unlisted=page.is_unlisted,
                paid_promotion=page.paid_promotion,
                transcript=transcript,
                transcript_error=transcript_error,
                links=tuple(
                    scraped.get(url) or LinkedPage(url=url, domain=domain_of(url), followed=False)
                    for url in links
                ),
                promo_codes=tuple(extract_promo_codes(page.description)),
                text=text,
                content_hash=content_hash(text),
            )
        )
    return Collection(query=query, paid_only=paid_only, videos=tuple(videos), failed=failed)
