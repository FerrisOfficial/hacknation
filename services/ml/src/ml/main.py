from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.routing import APIRoute
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from ml import knf, youtube
from ml.model import Label, predict_sentiment
from ml.scraper import ScrapeError, scrape


def _operation_id(route: APIRoute) -> str:
    return route.name


app = FastAPI(title="ML API", version="0.1.0", generate_unique_id_function=_operation_id)


# Modele pydantic = kontrakt API. Po każdej zmianie: `pnpm api:generate` w roocie repo.
class PredictRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class Prediction(BaseModel):
    label: Label
    score: float = Field(ge=0, le=1)


class ScrapeRequest(BaseModel):
    url: AnyHttpUrl
    include_html: bool = Field(
        default=False, description="Dołącz surowy HTML (np. do zapisu w materials.raw_html)."
    )


class ScrapeResult(BaseModel):
    url: str
    final_url: str = Field(description="Adres po przekierowaniach.")
    status_code: int
    title: str | None
    text: str = Field(description="Tekst bez tagów HTML, znormalizowane białe znaki.")
    content_hash: str = Field(description="SHA-256 znormalizowanego tekstu (deduplikacja).")
    language: str | None
    author: str | None
    description: str | None
    user_agent: str
    fetched_at: datetime
    html: str | None = None


class YoutubeCollectRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200, description="Fraza wyszukiwania w YouTube.")
    limit: int = Field(default=10, ge=1, le=50)
    paid_only: bool = Field(
        default=True,
        description="Tylko filmy z etykietą „Zawiera płatną promocję” (filtr wyszukiwarki).",
    )
    transcripts: bool = Field(
        default=True,
        description="Dołącz gotowe napisy YouTube jako tekst (pl, potem en). Bez pobierania wideo.",
    )
    follow_links: bool = Field(
        default=True, description="Pobierz strony z linków w opisie (bez social mediów twórcy)."
    )
    max_links_per_video: int = Field(default=5, ge=0, le=10)


class _FromAttributes(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class YoutubeTranscriptSegment(_FromAttributes):
    start: float = Field(description="Sekunda filmu — do linku `url&t=<start>s`.")
    text: str


class YoutubeTranscript(_FromAttributes):
    language: str
    is_generated: bool = Field(description="Napisy automatyczne (rozpoznawanie mowy).")
    text: str
    segments: list[YoutubeTranscriptSegment]


class YoutubeLinkedPage(_FromAttributes):
    url: str
    domain: str
    followed: bool = Field(description="False dla social mediów twórcy i linków ponad limit.")
    final_url: str | None = Field(description="Adres po przekierowaniach (np. link afiliacyjny).")
    final_domain: str | None
    title: str | None
    text: str | None
    content_hash: str | None
    error: str | None


class YoutubeVideo(_FromAttributes):
    video_id: str
    url: str
    title: str
    description: str
    channel: str | None = Field(description="Reklamujący (moduł 1) albo firma (moduł 2).")
    channel_id: str | None
    channel_url: str | None
    published_at: datetime | None
    duration_s: int | None
    view_count: int | None
    category: str | None
    keywords: list[str]
    is_unlisted: bool
    paid_promotion: bool = Field(
        description=(
            "Etykieta „Zawiera płatną promocję”. Deklaracja twórcy, YouTube jej nie sprawdza."
        )
    )
    transcript: YoutubeTranscript | None
    transcript_error: str | None
    links: list[YoutubeLinkedPage]
    promo_codes: list[str] = Field(description="Kody promocyjne/polecające z opisu.")
    text: str = Field(description="Tytuł, opis i transkrypcja — wejście dla modułów AI.")
    content_hash: str


class YoutubeFailedVideo(_FromAttributes):
    video_id: str
    error: str


class YoutubeCollection(_FromAttributes):
    query: str
    paid_only: bool
    videos: list[YoutubeVideo]
    failed: list[YoutubeFailedVideo]


class KnfIdentifier(_FromAttributes):
    kind: Literal["KRS", "NIP", "REGON"]
    value: str


class KnfWarning(_FromAttributes):
    category: str = Field(description="Podstawa prawna zawiadomienia (sekcja listy KNF).")
    number: int
    entities: str
    identifiers: list[KnfIdentifier]
    prosecutor: str | None
    rulings: str | None
    notes: str | None
    domains: list[str]


class KnfEntityAttribute(_FromAttributes):
    name: str
    value: str


class KnfEntity(_FromAttributes):
    id: int
    name: str
    former_names: list[str]
    deleted: bool
    register_name: str = Field(
        description="Rejestr KNF, np. „Firmy inwestycyjne - Domy maklerskie”."
    )
    register_id: int | None
    investment_register: bool = Field(
        description=(
            "Aktualny wpis w rejestrze usług inwestycyjnych (firmy inwestycyjne, domy maklerskie, "
            "notyfikacje z EOG, agenci). False dla danych historycznych i cofniętych zezwoleń."
        )
    )
    attributes: list[KnfEntityAttribute]
    domains: list[str]
    detail_url: str


class KnfEntitySearch(_FromAttributes):
    phrase: str
    total: int
    page: int
    per_page: int
    entities: list[KnfEntity]


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")


@app.post("/predict")
def predict(request: PredictRequest) -> Prediction:
    label, score = predict_sentiment(request.text)
    return Prediction(label=label, score=score)


@app.post("/scrape", responses={502: {"description": "Strony nie udało się pobrać"}})
def scrape_url(request: ScrapeRequest) -> ScrapeResult:
    try:
        page = scrape(str(request.url))
    except ScrapeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ScrapeResult(
        url=page.url,
        final_url=page.final_url,
        status_code=page.status_code,
        title=page.title,
        text=page.text,
        content_hash=page.content_hash,
        language=page.language,
        author=page.author,
        description=page.description,
        user_agent=page.user_agent,
        fetched_at=page.fetched_at,
        html=page.html if request.include_html else None,
    )


@app.post("/collect/youtube", responses={502: {"description": "Wyszukiwanie w YouTube zawiodło"}})
def collect_youtube(request: YoutubeCollectRequest) -> YoutubeCollection:
    """Filmy z YouTube z etykietą płatnej promocji, transkrypcją i stronami z linków w opisie."""
    try:
        collection = youtube.collect(
            request.query,
            limit=request.limit,
            paid_only=request.paid_only,
            transcripts=request.transcripts,
            follow_links=request.follow_links,
            max_links_per_video=request.max_links_per_video,
        )
    except youtube.YoutubeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return YoutubeCollection.model_validate(collection)


@app.get("/knf/warnings", responses={502: {"description": "Strony KNF nie udało się pobrać"}})
def knf_warnings() -> list[KnfWarning]:
    """Lista ostrzeżeń publicznych KNF (wszystkie sekcje)."""
    try:
        warnings = knf.fetch_public_warnings()
    except knf.KnfError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return [KnfWarning.model_validate(warning) for warning in warnings]


@app.get("/knf/entities", responses={502: {"description": "Strony KNF nie udało się pobrać"}})
def knf_entities(
    q: str = Query(min_length=2, max_length=200, description="Nazwa, KRS/NIP albo domena."),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=knf.MAX_PER_PAGE, ge=1, le=knf.MAX_PER_PAGE),
    include_deleted: bool = False,
) -> KnfEntitySearch:
    """Wyszukiwarka podmiotów KNF: czy firma jest w rejestrze i z jakim zakresem działalności."""
    try:
        result = knf.search_entities(
            q, page=page, per_page=per_page, include_deleted=include_deleted
        )
    except knf.KnfError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return KnfEntitySearch.model_validate(result)
