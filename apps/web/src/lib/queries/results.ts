import "server-only";
import {
  type AnalysisModule,
  type AnalysisResult,
  analysisResults,
  and,
  asc,
  count,
  type Db,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  type Material,
  materials,
  or,
  type SQL,
  sources,
  sql,
} from "@app/db";
import {
  ANALYSIS_MODULES,
  type RiskLevel,
  riskLevel,
  type Thresholds,
} from "@/lib/analysis/modules";
import { riskLevelSql } from "@/lib/pipeline/thresholds";
import type { ResultsQuery } from "@/lib/schemas";

// Odczyty dla dashboardu: lista wyników modułów (z filtrami po dacie, źródle, ryzyku, module),
// zunifikowane incydenty (materiał + wyniki modułów 1–3 w jednym obiekcie) i szczegóły materiału.

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function resultConditions(query: Partial<ResultsQuery>, thresholds: Thresholds): SQL[] {
  const conditions: (SQL | undefined)[] = [];
  if (query.module?.length) conditions.push(inArray(analysisResults.module, query.module));
  if (query.status?.length) conditions.push(inArray(analysisResults.status, query.status));
  if (query.risk?.length) conditions.push(inArray(riskLevelSql(thresholds), query.risk));
  if (query.platform?.length) conditions.push(inArray(materials.platform, query.platform));
  if (query.sourceId) conditions.push(eq(materials.sourceId, query.sourceId));
  if (query.from) conditions.push(gte(analysisResults.createdAt, query.from));
  if (query.to) conditions.push(lte(analysisResults.createdAt, query.to));
  if (query.minScore !== undefined) conditions.push(gte(analysisResults.score, query.minScore));
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(
      or(
        ilike(materials.title, pattern),
        ilike(materials.url, pattern),
        ilike(materials.author, pattern),
        ilike(materials.text, pattern),
      ),
    );
  }
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

const materialSummary = {
  id: materials.id,
  url: materials.url,
  title: materials.title,
  author: materials.author,
  platform: materials.platform,
  publishedAt: materials.publishedAt,
  scrapedAt: materials.scrapedAt,
  sourceId: materials.sourceId,
  sourceName: sources.name,
};

export type MaterialSummary = {
  id: string;
  url: string;
  title: string | null;
  author: string | null;
  platform: Material["platform"];
  publishedAt: Date | null;
  scrapedAt: Date;
  sourceId: string | null;
  sourceName: string | null;
};

export type ResultView = Omit<AnalysisResult, "reviewedBy" | "materialId"> & {
  threshold: number;
  riskLevel: RiskLevel;
};

function resultView(result: AnalysisResult, thresholds: Thresholds): ResultView {
  const { reviewedBy: _reviewedBy, materialId: _materialId, ...rest } = result;
  const threshold = thresholds[result.module];
  return { ...rest, threshold, riskLevel: riskLevel(result.score, threshold) };
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export async function listResults(
  db: Db,
  query: ResultsQuery,
  thresholds: Thresholds,
): Promise<Page<ResultView & { material: MaterialSummary }>> {
  const where = and(...resultConditions(query, thresholds));
  const order =
    query.sort === "score"
      ? [desc(analysisResults.score), desc(analysisResults.createdAt)]
      : [desc(analysisResults.createdAt), desc(analysisResults.score)];

  const [rows, [total]] = await Promise.all([
    db
      .select({ result: analysisResults, material: materialSummary })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .leftJoin(sources, eq(sources.id, materials.sourceId))
      .where(where)
      .orderBy(...order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: count() })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .where(where),
  ]);

  return {
    items: rows.map(({ result, material }) => ({ ...resultView(result, thresholds), material })),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

// ─── Agregator: materiał + wyniki modułów 1–3 jako jeden obiekt ─────────────────────────────

export type Incident = {
  material: MaterialSummary;
  maxScore: number;
  riskLevel: RiskLevel;
  // Moduły, w których materiał przekroczył próg.
  flaggedModules: AnalysisModule[];
  lastDetectedAt: Date;
  results: Record<AnalysisModule, ResultView | null>;
};

export function aggregateIncident(
  material: MaterialSummary,
  results: AnalysisResult[],
  thresholds: Thresholds,
): Incident {
  const byModule = Object.fromEntries(ANALYSIS_MODULES.map((m) => [m, null])) as Record<
    AnalysisModule,
    ResultView | null
  >;
  let maxScore = 0;
  let level: RiskLevel = "low";
  let lastDetectedAt = new Date(0);
  for (const result of results) {
    const view = resultView(result, thresholds);
    byModule[result.module] = view;
    maxScore = Math.max(maxScore, result.score);
    if (RISK_ORDER[view.riskLevel] > RISK_ORDER[level]) level = view.riskLevel;
    if (result.createdAt > lastDetectedAt) lastDetectedAt = result.createdAt;
  }
  return {
    material,
    maxScore,
    riskLevel: level,
    flaggedModules: ANALYSIS_MODULES.filter((m) => (byModule[m]?.riskLevel ?? "low") !== "low"),
    lastDetectedAt,
    results: byModule,
  };
}

export async function listIncidents(
  db: Db,
  query: ResultsQuery,
  thresholds: Thresholds,
): Promise<Page<Incident>> {
  // Filtry działają jak „materiał ma co najmniej jeden pasujący wynik”, a w odpowiedzi są
  // wszystkie wyniki materiału — analityk widzi pełny obraz z trzech modułów.
  const where = and(...resultConditions(query, thresholds));
  const maxScore = sql<number>`max(${analysisResults.score})`;
  const lastDetected = sql<Date>`max(${analysisResults.createdAt})`;

  const [matched, [total]] = await Promise.all([
    db
      .select({ id: materials.id })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .where(where)
      .groupBy(materials.id)
      .orderBy(
        ...(query.sort === "score"
          ? [desc(maxScore), desc(lastDetected)]
          : [desc(lastDetected), desc(maxScore)]),
        asc(materials.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ value: sql<number>`count(distinct ${materials.id})::int` })
      .from(analysisResults)
      .innerJoin(materials, eq(materials.id, analysisResults.materialId))
      .where(where),
  ]);

  const ids = matched.map((row) => row.id);
  if (ids.length === 0) {
    return { items: [], total: total?.value ?? 0, page: query.page, pageSize: query.pageSize };
  }
  const [materialRows, resultRows] = await Promise.all([
    db
      .select(materialSummary)
      .from(materials)
      .leftJoin(sources, eq(sources.id, materials.sourceId))
      .where(inArray(materials.id, ids)),
    db.select().from(analysisResults).where(inArray(analysisResults.materialId, ids)),
  ]);
  const materialById = new Map(materialRows.map((row) => [row.id, row]));

  return {
    items: ids.flatMap((id) => {
      const material = materialById.get(id);
      if (!material) return [];
      return [
        aggregateIncident(
          material,
          resultRows.filter((r) => r.materialId === id),
          thresholds,
        ),
      ];
    }),
    total: total?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getIncident(
  db: Db,
  materialId: string,
  thresholds: Thresholds,
): Promise<
  (Incident & { text: string; metadata: Record<string, unknown>; hasContent: boolean }) | null
> {
  const [row] = await db
    .select({
      summary: materialSummary,
      text: materials.text,
      metadata: materials.metadata,
      contentRef: materials.contentRef,
      rawHtml: sql<boolean>`${materials.rawHtml} is not null`,
    })
    .from(materials)
    .leftJoin(sources, eq(sources.id, materials.sourceId))
    .where(eq(materials.id, materialId));
  if (!row) return null;
  const results = await db
    .select()
    .from(analysisResults)
    .where(eq(analysisResults.materialId, materialId));
  return {
    ...aggregateIncident(row.summary, results, thresholds),
    text: row.text,
    metadata: row.metadata,
    hasContent: row.contentRef !== null || row.rawHtml,
  };
}
