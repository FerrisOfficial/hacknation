import logging
import os
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.routing import APIRoute
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

from ml import knf, risk, risk_llm, youtube
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
    links: list[str] = Field(
        default_factory=list,
        description="Linki wychodzące (inna domena niż strona), bez duplikatów, max 100.",
    )


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


class YoutubeChannelCollectRequest(BaseModel):
    channel_url: str = Field(
        min_length=20,
        max_length=300,
        description="Adres kanału, np. https://www.youtube.com/@kanal albo /channel/UC….",
    )
    limit: int = Field(default=15, ge=1, le=50, description="Ile najnowszych filmów.")
    transcripts: bool = True
    follow_links: bool = True
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


# --- Analiza materiału (docs/KONTRAKT.md §1-2)
AnalysisModuleName = Literal["finfluencer", "risk_disclosure", "unauthorized_advisory"]
FindingResult = Literal["violation", "ok", "n/a"]


class AnalyzeRequest(BaseModel):
    material_id: str = Field(min_length=1, max_length=100)
    module: AnalysisModuleName
    text: str = Field(max_length=500_000, description="materials.text")
    rules: list[str] = Field(
        default_factory=list,
        description="Reguły do oceny; pusta lista = wszystkie reguły modułu.",
    )


class AnalysisFinding(BaseModel):
    rule_id: str
    result: FindingResult
    confidence: float = Field(ge=0, le=1)
    quote: str | None = Field(description="Dosłowny fragment `text`, do 300 znaków.")
    reason: str


class RuleScoreOut(BaseModel):
    p_violation: float = Field(ge=0, le=1, description="P(naruszenie) reguły.")
    weight: float = Field(ge=0, le=1, description="Powaga reguły.")
    score: float = Field(ge=0, le=1, description="weight * p_violation — wkład do risk_score.")


class AnalyzeResponse(BaseModel):
    material_id: str
    label: str | None = Field(description="M1/M3; w M2 null.")
    probability: float | None = Field(ge=0, le=1, description="M1/M3; w M2 null.")
    summary: str
    findings: list[AnalysisFinding]
    risk_score: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description=(
            "Do sortowania listy zadań: score materiału z wszystkich reguł "
            "(noisy-OR z zanikiem po rule_scores). Nie porównuj go z progiem."
        ),
    )
    max_rule_score: float | None = Field(
        default=None,
        ge=0,
        le=1,
        description=(
            "Do progu: najwyższy rule_scores[*].score. Materiał jest incydentem przy progu t, "
            "gdy max_rule_score >= t (czyli gdy któraś reguła ma score >= t)."
        ),
    )
    rule_scores: dict[str, RuleScoreOut] = Field(
        default_factory=dict, description="Score każdej reguły, klucz = id reguły."
    )
    error: str | None = None


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")


@app.post("/predict")
def predict(request: PredictRequest) -> Prediction:
    label, score = predict_sentiment(request.text)
    return Prediction(label=label, score=score)


log = logging.getLogger(__name__)


def _risk_disclosure(text: str, rules: list[str] | None) -> risk.RiskAnalysis:
    """M2 wg M2_ENGINE: rules (regex), llm (Bielik, 13 reguł) albo hybrid.

    hybrid: regex decyduje, czy reguła dotyczy, a LLM ocenia naruszenie.
    """
    rule_based = risk.analyze_risk_disclosure(text, rules)
    engine = os.environ.get("M2_ENGINE", "rules")
    if engine not in ("llm", "hybrid"):
        return rule_based
    try:
        if engine == "hybrid":
            return risk_llm.analyze_risk_disclosure_hybrid(text, rules)
        llm = risk_llm.analyze_risk_disclosure_llm(text, rules)
    except risk_llm.LlmError:
        log.warning("Ocena M2 przez LLM nie powiodła się — wynik z reguł regex", exc_info=True)
        return rule_based
    by_rule = {f.rule_id: f for f in llm.findings}
    findings = [by_rule.get(f.rule_id, f) for f in rule_based.findings]
    return risk.RiskAnalysis(findings=findings, summary=risk.summarize(findings))


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """Ocena materiału przez jeden moduł AI: wynik każdej reguły z cytatem (KONTRAKT.md §2)."""
    if request.module != "risk_disclosure":
        return AnalyzeResponse(
            material_id=request.material_id, label=None, probability=None, summary="",
            findings=[], error=f"Moduł {request.module} nie jest jeszcze obsługiwany.",
        )  # fmt: skip
    unknown = sorted(set(request.rules) - set(risk.RULE_IDS))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Nieznane reguły M2: {', '.join(unknown)}")
    analysis = _risk_disclosure(request.text, request.rules or None)
    return AnalyzeResponse(
        material_id=request.material_id,
        label=None,
        probability=None,
        summary=analysis.summary,
        risk_score=risk.risk_score(analysis.findings),
        max_rule_score=risk.max_rule_score(analysis.findings),
        rule_scores={
            rule_id: RuleScoreOut(p_violation=s.p_violation, weight=s.weight, score=s.score)
            for rule_id, s in risk.rule_scores(analysis.findings).items()
        },
        findings=[
            AnalysisFinding(
                rule_id=f.rule_id, result=f.result, confidence=f.confidence,
                quote=f.quote, reason=f.reason,
            )
            for f in analysis.findings
        ],
    )  # fmt: skip


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
        links=list(page.links),
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


@app.post(
    "/collect/youtube/channel",
    responses={502: {"description": "Listy filmów kanału nie udało się pobrać"}},
)
def collect_youtube_channel(request: YoutubeChannelCollectRequest) -> YoutubeCollection:
    """Najnowsze filmy kanału (wszystkie, nie tylko płatne promocje) z transkrypcją i linkami."""
    try:
        youtube.channel_videos_url(request.channel_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        collection = youtube.collect(
            request.channel_url,
            limit=request.limit,
            paid_only=False,
            transcripts=request.transcripts,
            follow_links=request.follow_links,
            max_links_per_video=request.max_links_per_video,
            searcher=lambda url, limit, _paid: youtube.channel_videos(url, limit),
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
