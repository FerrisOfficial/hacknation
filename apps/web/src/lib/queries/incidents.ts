import "server-only";
import {
  analysisResults,
  and,
  type Db,
  desc,
  eq,
  materials,
  type ReviewStatus,
  sql,
} from "@app/db";
import type { Thresholds } from "@/lib/analysis/modules";
import { getContent } from "@/lib/content-store";
import {
  type IncidentDetail,
  type IncidentList,
  type IncidentListItem,
  readIncidentDetails,
} from "@/lib/incidents/contract";
import { thresholdSql } from "@/lib/pipeline/thresholds";
import type { IncidentsQuery } from "@/lib/schemas";
import { resultConditions } from "./results";

// Incydent = wynik jednego modułu AI dla materiału (wiersz `analysis_results`) ze score ≥ próg
// `flag` modułu. Kształty odpowiedzi: docs/KONTRAKT.md §4–§6.

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
        label: analysisResults.label,
        details: analysisResults.details,
        status: analysisResults.status,
        createdAt: analysisResults.createdAt,
        platform: materials.platform,
        url: materials.url,
      })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .where(where)
      .orderBy(
        desc(analysisResults.createdAt),
        desc(analysisResults.score),
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
        label: row.label,
        summary: details.summary,
        firm_name: details.entity.firm_name,
        advertiser: details.entity.advertiser,
        platform: row.platform,
        url: row.url,
        created_at: row.createdAt.toISOString(),
        status: row.status,
      };
    }),
    total: total?.value ?? 0,
  };
}

export async function getIncidentDetail(db: Db, id: string): Promise<IncidentDetail | null> {
  const [row] = await db
    .select({
      result: analysisResults,
      material: {
        url: materials.url,
        platform: materials.platform,
        title: materials.title,
        author: materials.author,
        text: materials.text,
        publishedAt: materials.publishedAt,
        scrapedAt: materials.scrapedAt,
        hasSnapshot: sql<boolean>`(${materials.contentRef} is not null or ${materials.rawHtml} is not null)`,
      },
    })
    .from(analysisResults)
    .innerJoin(materials, eq(materials.id, analysisResults.materialId))
    .where(eq(analysisResults.id, id));
  if (!row) return null;
  const { result, material } = row;
  return {
    id: result.id,
    module: result.module,
    score: roundScore(result.score),
    label: result.label,
    status: result.status,
    created_at: result.createdAt.toISOString(),
    material: {
      url: material.url,
      platform: material.platform,
      title: material.title,
      author: material.author,
      text: material.text,
      published_at: material.publishedAt?.toISOString() ?? null,
      scraped_at: material.scrapedAt.toISOString(),
      has_snapshot: material.hasSnapshot,
    },
    details: readIncidentDetails(result.details),
  };
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

// Zmiana statusu przez analityka. confirmed/dismissed to prawda bazowa panelu kalibracji.
export async function updateIncidentStatus(db: Db, id: string, status: ReviewStatus) {
  const decided = status === "confirmed" || status === "dismissed";
  const [updated] = await db
    .update(analysisResults)
    .set({ status, reviewedAt: decided ? new Date() : null })
    .where(eq(analysisResults.id, id))
    .returning({
      id: analysisResults.id,
      materialId: analysisResults.materialId,
      module: analysisResults.module,
      status: analysisResults.status,
    });
  return updated ?? null;
}

// `real` (float4) wraca jako 0.8000000119 — do API oddajemy 4 miejsca po przecinku.
function roundScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}
