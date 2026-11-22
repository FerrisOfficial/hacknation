import "server-only";
import {
  analysisResults,
  and,
  type Db,
  desc,
  eq,
  incidentEvents,
  materials,
  type ReviewStatus,
  reviewers,
  sql,
} from "@app/db";
import type { Thresholds } from "@/lib/analysis/modules";
import { riskScore } from "@/lib/analysis/risk";
import { getContent } from "@/lib/content-store";
import {
  type HistoryEntry,
  type IncidentDetail,
  type IncidentList,
  type IncidentListItem,
  type Review,
  type Reviewer,
  readIncidentDetails,
} from "@/lib/incidents/contract";
import { statusAction, withDetection } from "@/lib/incidents/history";
import { getThresholds, riskScoreSql, thresholdSql } from "@/lib/pipeline/thresholds";
import { currentReviewer } from "@/lib/reviewer";
import type { IncidentsQuery } from "@/lib/schemas";
import { resultConditions } from "./results";
import { knfScopeSql } from "./scope";

// Incydent = wynik jednego modułu AI dla materiału (wiersz `analysis_results`) ze score ≥ próg
// `flag` modułu (M2: któraś reguła ≥ próg). Kolejność: risk_score (priorytet) albo data.
// Kształty odpowiedzi: docs/KONTRAKT.md §4–§6.

const reviewColumns = {
  status: analysisResults.status,
  reviewedAt: analysisResults.reviewedAt,
  reviewNote: analysisResults.reviewNote,
  reviewerId: reviewers.id,
  reviewerName: reviewers.name,
  reviewerRole: reviewers.role,
};

type ReviewRow = {
  status: ReviewStatus;
  reviewedAt: Date | null;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerRole: string | null;
};

function reviewerOf(id: string | null, name: string | null, role: string | null): Reviewer | null {
  return id && name ? { id, name, role } : null;
}

function readReview(row: ReviewRow): Review {
  return {
    status: row.status,
    reviewed_by: reviewerOf(row.reviewerId, row.reviewerName, row.reviewerRole),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    review_note: row.reviewNote,
  };
}

export async function listIncidentItems(
  db: Db,
  query: IncidentsQuery,
  thresholds: Thresholds,
): Promise<IncidentList> {
  const where = and(
    sql`${analysisResults.score} >= ${thresholdSql(thresholds)}`,
    ...resultConditions(
      {
        module: query.module,
        status: query.status,
        platform: query.platform,
        from: query.from,
        to: query.to,
        minScore: query.min_score,
      },
      thresholds,
    ),
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: analysisResults.id,
        module: analysisResults.module,
        score: analysisResults.score,
        priority: riskScoreSql(thresholds),
        label: analysisResults.label,
        details: analysisResults.details,
        createdAt: analysisResults.createdAt,
        platform: materials.platform,
        url: materials.url,
        title: materials.title,
        ...reviewColumns,
      })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .leftJoin(reviewers, eq(reviewers.id, analysisResults.reviewedBy))
      .where(where)
      .orderBy(
        ...(query.sort === "date"
          ? [desc(analysisResults.createdAt), desc(analysisResults.score)]
          : [desc(riskScoreSql(thresholds)), desc(analysisResults.createdAt)]),
        desc(analysisResults.id),
      )
      .limit(query.page_size)
      .offset((query.page - 1) * query.page_size),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .where(where),
  ]);

  return {
    items: rows.map((row): IncidentListItem => {
      const details = readIncidentDetails(row.details);
      return {
        id: row.id,
        module: row.module,
        score: roundScore(row.score),
        risk_score: roundScore(row.priority),
        label: row.label,
        summary: details.summary,
        firm_name: details.entity.firm_name,
        advertiser: details.entity.advertiser,
        platform: row.platform,
        url: row.url,
        created_at: row.createdAt.toISOString(),
        title: row.title,
        in_register: details.entity.in_register,
        on_warning_list: details.entity.on_warning_list,
        ...readReview(row),
      };
    }),
    total: total?.value ?? 0,
  };
}

// SHA-256 zapisanej kopii (R4): obiekt w bazie treści jest adresowany SHA-256 surowego HTML-a,
// kopia w kolumnie raw_html liczona na miejscu, a bez kopii — skrót tekstu materiału.
const contentHashSql = sql<string>`coalesce(
  case when ${materials.contentRef} like 'sha256:%' then substr(${materials.contentRef}, 8) end,
  encode(sha256(convert_to(${materials.rawHtml}, 'UTF8')), 'hex'),
  ${materials.contentHash}
)`;

// Długość filmu z metadanych YouTube (`metadata.duration_s`), bez czytania całego jsonb (napisy).
const durationSql = sql<
  number | null
>`case when jsonb_typeof(${materials.metadata}->'duration_s') = 'number'
  then (${materials.metadata}->>'duration_s')::float8 end`;

// Film pobrany przez serwis media (`metadata.frames.status = "done"`, @/lib/media-state).
const hasVideoSql = sql<boolean>`coalesce(${materials.metadata}->'frames'->>'status' = 'done', false)`;

// Materiał incydentu dla filmu i klatek: id w serwisie media i stan pobrania. null = brak.
export async function getIncidentVideoCandidate(db: Db, id: string) {
  const [row] = await db
    .select({
      id: materials.id,
      platform: materials.platform,
      frames: sql<unknown>`${materials.metadata}->'frames'`,
    })
    .from(analysisResults)
    .innerJoin(materials, eq(materials.id, analysisResults.materialId))
    .where(eq(analysisResults.id, id));
  return row ?? null;
}

export async function getIncidentDetail(db: Db, id: string): Promise<IncidentDetail | null> {
  const [row] = await db
    .select({
      id: analysisResults.id,
      module: analysisResults.module,
      score: analysisResults.score,
      label: analysisResults.label,
      details: analysisResults.details,
      createdAt: analysisResults.createdAt,
      ...reviewColumns,
      material: {
        url: materials.url,
        platform: materials.platform,
        title: materials.title,
        author: materials.author,
        text: materials.text,
        publishedAt: materials.publishedAt,
        scrapedAt: materials.scrapedAt,
        hasSnapshot: sql<boolean>`(${materials.contentRef} is not null or ${materials.rawHtml} is not null)`,
        durationS: durationSql,
        contentHash: contentHashSql,
        hasVideo: hasVideoSql,
      },
    })
    .from(analysisResults)
    .innerJoin(materials, eq(materials.id, analysisResults.materialId))
    .leftJoin(reviewers, eq(reviewers.id, analysisResults.reviewedBy))
    .where(and(eq(analysisResults.id, id), knfScopeSql()));
  if (!row) return null;
  const { material } = row;
  const score = roundScore(row.score);
  const createdAt = row.createdAt.toISOString();
  const details = readIncidentDetails(row.details);
  const thresholds = await getThresholds(db);
  return {
    id: row.id,
    module: row.module,
    score,
    risk_score: riskScore(details.flags, thresholds[row.module], score),
    label: row.label,
    created_at: createdAt,
    ...readReview(row),
    material: {
      url: material.url,
      platform: material.platform,
      title: material.title,
      author: material.author,
      text: material.text,
      published_at: material.publishedAt?.toISOString() ?? null,
      scraped_at: material.scrapedAt.toISOString(),
      has_snapshot: material.hasSnapshot,
      has_video: material.hasVideo,
      duration_s: material.durationS === null ? null : Number(material.durationS),
      content_hash: material.contentHash,
    },
    details,
    history: withDetection(await incidentEventsOf(db, id), { at: createdAt, score }),
  };
}

async function incidentEventsOf(db: Db, resultId: string) {
  const rows = await db
    .select({
      kind: incidentEvents.kind,
      at: incidentEvents.at,
      action: incidentEvents.action,
      status: incidentEvents.status,
      actorId: reviewers.id,
      actorName: reviewers.name,
      actorRole: reviewers.role,
    })
    .from(incidentEvents)
    .leftJoin(reviewers, eq(reviewers.id, incidentEvents.actorId))
    .where(eq(incidentEvents.resultId, resultId))
    .orderBy(desc(incidentEvents.at));
  return rows.map((row): HistoryEntry & { kind: typeof row.kind } => ({
    kind: row.kind,
    at: row.at.toISOString(),
    actor: reviewerOf(row.actorId, row.actorName, row.actorRole),
    action: row.action,
    status: row.status,
  }));
}

// Surowy HTML materiału z dnia scrapingu (baza treści albo kolumna raw_html). null = brak.
export async function getIncidentSnapshot(db: Db, id: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ contentRef: materials.contentRef, rawHtml: materials.rawHtml })
    .from(analysisResults)
    .innerJoin(materials, eq(materials.id, analysisResults.materialId))
    .where(eq(analysisResults.id, id));
  if (!row) return undefined;
  return row.contentRef ? await getContent(row.contentRef) : row.rawHtml;
}

// Zmiana statusu przez analityka (§6). Zapisuje autora i czas (R16) — także przy automatycznym
// `in_review` po otwarciu sprawy — oraz zdarzenie w historii, gdy status albo powód się zmienił.
// `new` (cofnięcie decyzji) czyści autora. confirmed/dismissed to prawda bazowa kalibracji.
export async function updateIncidentStatus(
  db: Db,
  id: string,
  change: { status: ReviewStatus; note: string | null },
) {
  const reviewer = currentReviewer();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: analysisResults.status, note: analysisResults.reviewNote })
      .from(analysisResults)
      .where(eq(analysisResults.id, id))
      .for("update");
    if (!current) return null;

    await tx
      .insert(reviewers)
      .values(reviewer)
      .onConflictDoUpdate({
        target: reviewers.id,
        set: { name: reviewer.name, role: reviewer.role, updatedAt: sql`now()` },
      });

    const reset = change.status === "new";
    const [updated] = await tx
      .update(analysisResults)
      .set({
        status: change.status,
        reviewNote: change.note,
        reviewedBy: reset ? null : reviewer.id,
        reviewedAt: reset ? null : new Date(),
      })
      .where(eq(analysisResults.id, id))
      .returning({
        id: analysisResults.id,
        materialId: analysisResults.materialId,
        module: analysisResults.module,
        status: analysisResults.status,
      });

    if (updated && (current.status !== change.status || current.note !== change.note)) {
      await tx.insert(incidentEvents).values({
        resultId: id,
        kind: "status",
        actorId: reviewer.id,
        action: statusAction(change.status, change.note),
        status: change.status,
      });
    }
    return updated ?? null;
  });
}

// `real` (float4) wraca jako 0.8000000119 — do API oddajemy 4 miejsca po przecinku.
export function roundScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}
