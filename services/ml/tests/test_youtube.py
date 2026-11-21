"""Testy kolektora YouTube bez sieci.

Strony filmów budujemy z JSON-a, HTTP idzie przez MockTransport/respx, a wyszukiwarkę
i transkrypcje podmieniamy funkcjami.
"""

import json
from datetime import UTC, datetime

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from youtube_transcript_api import FetchedTranscript, FetchedTranscriptSnippet, TranscriptsDisabled

from ml import youtube
from ml.main import app
from ml.scraper import content_hash
from ml.youtube import (
    PAID_PROMOTION_FILTER,
    SearchHit,
    Transcript,
    TranscriptSegment,
    TranscriptUnavailable,
    YoutubeError,
    collect,
    description_links,
    extract_links,
    extract_promo_codes,
    fetch_transcript,
    is_followable,
    parse_watch_page,
    search_url,
)

client = TestClient(app)

PAID_ID = "AAAAAAAAAA1"
PLAIN_ID = "BBBBBBBBBB2"
BROKEN_ID = "CCCCCCCCCC3"

PAID_DESCRIPTION = (
    "Załóż konto u brokera: https://geolink.broker.example/abc123\n"
    'Kod promocyjny: "KANAL50" - dostaniesz kurs.\n'
    "Materiał sponsorowany.\n"
    "Mój Instagram: https://www.instagram.com/kanal.testowy\n"
    "Poprzedni film: https://youtu.be/DDDDDDDDDD4\n"
    "Kurs: www.kurs-inwestowania.example/zapisy."
)
PLAIN_DESCRIPTION = "Też polecam: https://geolink.broker.example/abc123 (ten sam link)."


def player(
    video_id: str,
    *,
    description: str,
    paid: bool,
    status: str = "OK",
) -> dict[str, object]:
    data: dict[str, object] = {
        "playabilityStatus": {"status": status, "reason": "Film jest prywatny"},
        "videoDetails": {
            "videoId": video_id,
            "title": f"Jak zacząć inwestować ({video_id})",
            "lengthSeconds": "754",
            "keywords": ["inwestowanie", "ETF"],
            "channelId": "UCkanalTestowy00000000",
            "shortDescription": description,
            "viewCount": "12345",
            "author": "Kanał Testowy",
        },
        "microformat": {
            "playerMicroformatRenderer": {
                "ownerProfileUrl": "http://www.youtube.com/@KanalTestowy",
                "publishDate": "2026-08-12T10:10:55-07:00",
                "category": "Education",
                "isUnlisted": False,
            }
        },
    }
    if paid:
        data["paidContentOverlay"] = {
            "paidContentOverlayRenderer": {
                "text": {"simpleText": "Zawiera płatną promocję"},
                "durationMs": "10000",
            }
        }
    return data


def watch_html(data: dict[str, object]) -> str:
    return (
        "<!doctype html><html><head><title>YouTube</title></head><body>"
        f"<script>var ytInitialPlayerResponse = {json.dumps(data, ensure_ascii=False)};"
        'var meta = document.createElement("meta");</script></body></html>'
    )


PAGES = {
    PAID_ID: watch_html(player(PAID_ID, description=PAID_DESCRIPTION, paid=True)),
    PLAIN_ID: watch_html(player(PLAIN_ID, description=PLAIN_DESCRIPTION, paid=False)),
}
BROKER_HTML = (
    "<html lang='pl'><head><title>Broker Przykładowy — konto</title></head>"
    "<body><main><p>Otwórz rachunek. Inwestowanie wiąże się z ryzykiem.</p></main></body></html>"
)
KURS_HTML = "<html><head><title>Kurs</title></head><body><main><p>Zapisy</p></main></body></html>"


def html_response(body: str) -> httpx.Response:
    return httpx.Response(200, text=body, headers={"content-type": "text/html; charset=utf-8"})


def web_handler(seen: list[str]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        host = request.url.host
        if host == "www.youtube.com":
            page = PAGES.get(request.url.params.get("v", ""))
            return html_response(page) if page else httpx.Response(404)
        if host == "geolink.broker.example":
            return httpx.Response(302, headers={"location": "https://www.broker.example/pl/konto"})
        if host == "www.broker.example":
            return html_response(BROKER_HTML)
        if host == "www.kurs-inwestowania.example":
            return html_response(KURS_HTML)
        return httpx.Response(500)

    return httpx.MockTransport(handle)


def fake_searcher(query: str, limit: int, paid_only: bool) -> list[SearchHit]:
    hits = [SearchHit(video_id=v, title=None, channel=None) for v in (PAID_ID, PLAIN_ID, BROKEN_ID)]
    return hits[:limit]


def fake_transcript(video_id: str) -> Transcript:
    if video_id == PLAIN_ID:
        raise TranscriptUnavailable("TranscriptsDisabled")
    return Transcript(
        language="pl",
        is_generated=True,
        segments=(
            TranscriptSegment(start=0.0, text="Cześć, dziś zakładamy konto."),
            TranscriptSegment(start=61.5, text="Partnerem odcinka jest broker."),
        ),
    )


# ─── Strona filmu ───────────────────────────────────────────────────────────────────────────────


def test_parse_watch_page_reads_metadata_and_paid_label() -> None:
    page = parse_watch_page(PAGES[PAID_ID], PAID_ID)
    assert page.title == f"Jak zacząć inwestować ({PAID_ID})"
    assert page.description == PAID_DESCRIPTION
    assert page.channel == "Kanał Testowy"
    assert page.channel_url == "https://www.youtube.com/@KanalTestowy"
    assert page.published_at == datetime(2026, 8, 12, 17, 10, 55, tzinfo=UTC)
    assert page.duration_s == 754
    assert page.view_count == 12345
    assert page.keywords == ("inwestowanie", "ETF")
    assert page.is_unlisted is False
    assert page.paid_promotion is True


def test_parse_watch_page_without_label() -> None:
    assert parse_watch_page(PAGES[PLAIN_ID], PLAIN_ID).paid_promotion is False


def test_parse_watch_page_rejects_unavailable_and_missing_data() -> None:
    private = watch_html(player(PAID_ID, description="", paid=False, status="LOGIN_REQUIRED"))
    with pytest.raises(YoutubeError, match="prywatny"):
        parse_watch_page(private, PAID_ID)
    with pytest.raises(YoutubeError, match="nie ma danych"):
        parse_watch_page("<html><body>Zanim przejdziesz do YouTube</body></html>", PAID_ID)


# ─── Opis ───────────────────────────────────────────────────────────────────────────────────────


def test_extract_links_trims_punctuation_and_dedupes() -> None:
    text = "Strona: https://a.example/x?y=1, oraz www.b.example. Znowu https://a.example/x?y=1!"
    assert extract_links(text) == ["https://a.example/x?y=1", "https://www.b.example"]


def test_extract_links_stops_at_invisible_characters() -> None:
    text = "Konto: https://bank.example.pl​kod ABC i www.broker.example﻿/x oraz ​"
    assert extract_links(text) == ["https://bank.example.pl", "https://www.broker.example"]


def test_description_links_skip_youtube_but_keep_social_profiles() -> None:
    links = description_links(PAID_DESCRIPTION)
    assert links == [
        "https://geolink.broker.example/abc123",
        "https://www.instagram.com/kanal.testowy",
        "https://www.kurs-inwestowania.example/zapisy",
    ]
    assert [is_followable(url) for url in links] == [True, False, True]


def test_extract_promo_codes() -> None:
    assert extract_promo_codes(PAID_DESCRIPTION) == ["KANAL50"]
    assert extract_promo_codes("Z kodem polecającym ABC-12 i kodem XYZ99 taniej") == [
        "ABC-12",
        "XYZ99",
    ]
    assert extract_promo_codes("kod rabatowy: Kurs, kod do aplikacji, kod 2026") == []


def test_search_url_with_paid_promotion_filter() -> None:
    assert search_url("XTB kod", paid_only=False) == (
        "https://www.youtube.com/results?search_query=XTB+kod"
    )
    assert search_url("XTB kod", paid_only=True).endswith(
        f"&sp={PAID_PROMOTION_FILTER.replace('=', '%3D')}"
    )


# ─── Transkrypcja ───────────────────────────────────────────────────────────────────────────────


class _FakeTranscriptApi:
    def __init__(self, proxy_config: object = None) -> None:
        self.proxy_config = proxy_config

    def fetch(self, video_id: str, languages: list[str]) -> FetchedTranscript:
        if video_id == PLAIN_ID:
            raise TranscriptsDisabled(video_id)
        snippets = [
            FetchedTranscriptSnippet(text=" Dzień dobry ", start=0.0, duration=1.0),
            FetchedTranscriptSnippet(text="\n", start=1.0, duration=1.0),
            FetchedTranscriptSnippet(text="inwestujemy", start=2.5, duration=1.0),
        ]
        return FetchedTranscript(
            snippets=snippets,
            video_id=video_id,
            language="Polish (auto-generated)",
            language_code=languages[0],
            is_generated=True,
        )


def test_fetch_transcript(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(youtube, "YouTubeTranscriptApi", _FakeTranscriptApi)
    transcript = fetch_transcript(PAID_ID)
    assert transcript.language == "pl"
    assert transcript.is_generated is True
    assert [s.start for s in transcript.segments] == [0.0, 2.5]
    assert transcript.text == "Dzień dobry inwestujemy"

    with pytest.raises(TranscriptUnavailable, match="TranscriptsDisabled"):
        fetch_transcript(PLAIN_ID)


# ─── Całość ─────────────────────────────────────────────────────────────────────────────────────


def test_collect_videos_transcripts_and_linked_pages() -> None:
    seen: list[str] = []
    with httpx.Client(transport=web_handler(seen), follow_redirects=True) as http:
        result = collect(
            "jak inwestować",
            client=http,
            searcher=fake_searcher,
            transcript_fetcher=fake_transcript,
        )

    assert [failed.video_id for failed in result.failed] == [BROKEN_ID]
    paid, plain = result.videos
    assert (paid.video_id, paid.paid_promotion) == (PAID_ID, True)
    assert (plain.video_id, plain.paid_promotion) == (PLAIN_ID, False)
    assert paid.url == f"https://www.youtube.com/watch?v={PAID_ID}"
    assert paid.promo_codes == ("KANAL50",)

    assert paid.transcript is not None
    assert paid.transcript.segments[1].start == 61.5
    assert "Partnerem odcinka jest broker." in paid.text
    assert paid.text.startswith(paid.title)
    assert paid.content_hash == content_hash(paid.text)
    assert (plain.transcript, plain.transcript_error) == (None, "TranscriptsDisabled")

    geolink, instagram, kurs = paid.links
    assert geolink.followed and geolink.final_domain == "broker.example"
    assert geolink.title == "Broker Przykładowy — konto"
    assert geolink.text == "Otwórz rachunek. Inwestowanie wiąże się z ryzykiem."
    assert (instagram.domain, instagram.followed) == ("instagram.com", False)
    assert kurs.followed and kurs.title == "Kurs"
    # Ten sam link afiliacyjny w dwóch filmach pobieramy raz.
    assert plain.links == (geolink,)
    assert seen.count("https://geolink.broker.example/abc123") == 1
    assert not any("instagram" in url or "youtu.be" in url for url in seen)


def test_collect_respects_limits_and_switches() -> None:
    seen: list[str] = []
    with httpx.Client(transport=web_handler(seen), follow_redirects=True) as http:
        result = collect(
            "jak inwestować",
            limit=1,
            transcripts=False,
            max_links_per_video=1,
            client=http,
            searcher=fake_searcher,
            transcript_fetcher=fake_transcript,
        )
        (video,) = result.videos
        assert (video.transcript, video.transcript_error) == (None, None)
        assert [link.followed for link in video.links] == [True, False, False]

        no_links = collect(
            "x", limit=1, follow_links=False, client=http, searcher=fake_searcher
        ).videos[0]
    assert not any(link.followed for link in no_links.links)


# ─── Endpoint ───────────────────────────────────────────────────────────────────────────────────


@respx.mock
def test_collect_youtube_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(youtube, "search_videos", fake_searcher)
    monkeypatch.setattr(youtube, "fetch_transcript", fake_transcript)
    respx.route(host="www.youtube.com").mock(side_effect=web_handler([]).handle_request)
    respx.route(host__regex=r".*\.example$").mock(side_effect=web_handler([]).handle_request)

    response = client.post("/collect/youtube", json={"query": "jak inwestować", "limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["paid_only"] is True
    assert [v["video_id"] for v in body["videos"]] == [PAID_ID, PLAIN_ID]
    paid = body["videos"][0]
    assert paid["paid_promotion"] is True
    assert (
        paid["transcript"]["text"] == "Cześć, dziś zakładamy konto. Partnerem odcinka jest broker."
    )
    assert paid["transcript"]["segments"][1] == {
        "start": 61.5,
        "text": "Partnerem odcinka jest broker.",
    }
    assert paid["links"][0]["final_url"] == "https://www.broker.example/pl/konto"
    assert paid["promo_codes"] == ["KANAL50"]
    assert paid["published_at"] == "2026-08-12T10:10:55-07:00"


def test_collect_youtube_endpoint_search_error_is_502(monkeypatch: pytest.MonkeyPatch) -> None:
    def failing(query: str, limit: int, paid_only: bool) -> list[SearchHit]:
        raise YoutubeError("Sign in to confirm you're not a bot")

    monkeypatch.setattr(youtube, "search_videos", failing)
    response = client.post("/collect/youtube", json={"query": "XTB"})
    assert response.status_code == 502
    assert "bot" in response.json()["detail"]


def test_collect_youtube_endpoint_validates_input() -> None:
    assert client.post("/collect/youtube", json={"query": ""}).status_code == 422
    assert client.post("/collect/youtube", json={"query": "x", "limit": 0}).status_code == 422
    assert client.post("/collect/youtube", json={"query": "x", "limit": 51}).status_code == 422


def test_channel_videos_url_accepts_channel_forms_only() -> None:
    assert (
        youtube.channel_videos_url("https://www.youtube.com/@KanalTestowy")
        == "https://www.youtube.com/@KanalTestowy/videos"
    )
    assert (
        youtube.channel_videos_url("https://m.youtube.com/channel/UC1234567890123456789012/shorts")
        == "https://www.youtube.com/channel/UC1234567890123456789012/videos"
    )
    with pytest.raises(ValueError):
        youtube.channel_videos_url("https://evil.example/@kanal")
    with pytest.raises(ValueError):
        youtube.channel_videos_url("https://www.youtube.com/watch?v=AAAAAAAAAA1")


@respx.mock
def test_collect_youtube_channel_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, int]] = []

    def fake_channel(url: str, limit: int) -> list[SearchHit]:
        seen.append((url, limit))
        return fake_searcher(url, limit, False)

    monkeypatch.setattr(youtube, "channel_videos", fake_channel)
    monkeypatch.setattr(youtube, "fetch_transcript", fake_transcript)
    respx.route(host="www.youtube.com").mock(side_effect=web_handler([]).handle_request)
    respx.route(host__regex=r".*\.example$").mock(side_effect=web_handler([]).handle_request)

    url = "https://www.youtube.com/@KanalTestowy"
    response = client.post("/collect/youtube/channel", json={"channel_url": url, "limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert seen == [(url, 2)]
    assert body["query"] == url
    assert body["paid_only"] is False
    assert [v["video_id"] for v in body["videos"]] == [PAID_ID, PLAIN_ID]


def test_collect_youtube_channel_endpoint_rejects_non_channel_url() -> None:
    response = client.post(
        "/collect/youtube/channel", json={"channel_url": "https://evil.example/@kanal/x"}
    )
    assert response.status_code == 422


def test_collect_raises_when_youtube_rate_limits_every_video() -> None:
    blocked = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(429)))
    with pytest.raises(YoutubeError, match="HTTP 429"):
        youtube.collect(
            "XTB kod",
            limit=2,
            client=blocked,
            searcher=fake_searcher,
            transcript_fetcher=fake_transcript,
        )


def test_collect_stops_asking_youtube_after_first_429() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(429)

    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as blocked,
        pytest.raises(YoutubeError, match="HTTP 429"),
    ):
        youtube.collect(
            "XTB kod",
            limit=3,
            client=blocked,
            searcher=fake_searcher,
            transcript_fetcher=fake_transcript,
        )
    assert len(calls) == 1


def test_youtube_delay_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOUTUBE_DELAY_S", "1.5")
    assert youtube.youtube_delay_s() == 1.5
    monkeypatch.setenv("YOUTUBE_DELAY_S", "abc")
    assert youtube.youtube_delay_s() == youtube.DEFAULT_YOUTUBE_DELAY_S
    monkeypatch.delenv("YOUTUBE_DELAY_S")
    assert youtube.youtube_delay_s() == youtube.DEFAULT_YOUTUBE_DELAY_S
