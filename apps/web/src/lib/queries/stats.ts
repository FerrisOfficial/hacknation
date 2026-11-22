import "server-only";
import {
  type AnalysisModule,
  analysisResults,
  and,
  count,
  type Db,
  eq,
  gte,
  inArray,
  lte,
  materials,
  type ReviewStatus,
  type SQL,
  scrapeJobs,
  sources,
  sql,
} from "@app/db";
import type { ScoreBucket } from "@/lib/analysis/calibration";
import { ANALYSIS_MODULES, type Thresholds, UNDECIDED_STATUSES } from "@/lib/analysis/modules";
import { highRiskSql, riskLevelSql, thresholdSql } from "@/lib/pipeline/thresholds";
import type { TrendQuery } from "@/lib/schemas";

// Strefa czasowa koszyków trendu — dzień „21.11” ma się zgadzać z kalendarzem analityka.
const TIME_ZONE = "Europe/Warsaw";
const MAX_BUCKETS = 1_000;
const DAY_MS = 86_400_000;

export type TrendPoint = { bucket: string; total: number } & Record<AnalysisModule, number>;

export function trendRange(query: TrendQuery, now = new Date()): { from: Date; to: Date } {
  const to = query.to ?? now;
  const defaultSpan =
    query.bucket === "hour" ? 2 * DAY_MS : query.bucket === "week" ? 180 * DAY_MS : 30 * DAY_MS;
  const from = query.from ?? new Date(to.getTime() - defaultSpan);
  return { from, to };
}

const BUCKET_MS: Record<TrendQuery["bucket"], number> = {
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
};

// Liczba wykrytych incydentów w czasie (wykres trendu): koszyki bez incydentów też są (zera),
// żeby wykres nie „przeskakiwał” pustych dni.
export async function incidentTrend(
  db: Db,
  query: TrendQuery,
  thresholds: Thresholds,
): Promise<{ bucket: TrendQuery["bucket"]; from: Date; to: Date; points: TrendPoint[] }> {
  const { from, to } = trendRange(query);
  if ((to.getTime() - from.getTime()) / BUCKET_MS[query.bucket] > MAX_BUCKETS) {
    throw new RangeError(`Zakres daje ponad ${MAX_BUCKETS} koszyków — zwiększ \`bucket\``);
  }
  const unit = sql.raw(`'${query.bucket}'`);
  const step = sql.raw(`'1 ${query.bucket}'`);
  const label = sql.raw(query.bucket === "hour" ? `'YYYY-MM-DD"T"HH24:00'` : `'YYYY-MM-DD'`);
  const tz = sql.raw(`'${TIME_ZONE}'`);

  const conditions: SQL[] = [
    gte(analysisResults.createdAt, from),
    lte(analysisResults.createdAt, to),
  ];
  if (query.scope === "flagged")
    conditions.push(sql`${analysisResults.score} >= ${thresholdSql(thresholds)}`);
  if (query.scope === "high")
    conditions.push(sql`${analysisResults.score} >= ${highRiskSql(thresholds)}`);
  if (query.module?.length) conditions.push(inArray(analysisResults.module, query.module));
  if (query.platform?.length) conditions.push(inArray(materials.platform, query.platform));

  const rows = await db.execute<{ bucket: string; module: AnalysisModule | null; n: number }>(sql`
    with buckets as (
      select generate_series(
        date_trunc(${unit}, timezone(${tz}, ${from.toISOString()}::timestamptz)),
        date_trunc(${unit}, timezone(${tz}, ${to.toISOString()}::timestamptz)),
        ${step}::interval
      ) as bucket
    ),
    hits as (
      select date_trunc(${unit}, timezone(${tz}, ${analysisResults.createdAt})) as bucket,
        ${analysisResults.module}::text as module, count(*)::int as n
      from ${analysisResults}
      inner join ${materials} on ${materials.id} = ${analysisResults.materialId}
      where ${and(...conditions)}
      group by 1, 2
    )
    select to_char(b.bucket, ${label}) as bucket, h.module, coalesce(h.n, 0)::int as n
    from buckets b left join hits h on h.bucket = b.bucket
    order by b.bucket
  `);

  const points = new Map<string, TrendPoint>();
  for (const row of rows) {
    const point = points.get(row.bucket) ?? {
      bucket: row.bucket,
      total: 0,
      finfluencer: 0,
      risk_disclosure: 0,
      unauthorized_advisory: 0,
    };
    if (row.module) {
      point[row.module] += row.n;
      point.total += row.n;
    }
    points.set(row.bucket, point);
  }
  return { bucket: query.bucket, from, to, points: [...points.values()] };
}

export async function summary(db: Db, thresholds: Thresholds) {
  const since24h = new Date(Date.now() - DAY_MS);
  const level = riskLevelSql(thresholds);
  const [sourceRows, materialRows, resultRows, jobRows] = await Promise.all([
    db.select({ active: sources.active, n: count() }).from(sources).groupBy(sources.active),
    db
      .select({
        platform: materials.platform,
        n: count(),
        analyzed: sql<number>`count(*) filter (where ${materials.analyzedAt} is not null)::int`,
      })
      .from(materials)
      .groupBy(materials.platform),
    db
      .select({
        module: analysisResults.module,
        risk: level,
        status: analysisResults.status,
        n: count(),
      })
      .from(analysisResults)
      // Po pozycjach: wyrażenie z parametrami w GROUP BY to dla Postgresa inne wyrażenie niż
      // to samo w SELECT (inne numery $n).
      .groupBy(sql`1, 2, 3`),
    db
      .select({ status: scrapeJobs.status, n: count() })
      .from(scrapeJobs)
      .where(gte(scrapeJobs.createdAt, since24h))
      .groupBy(scrapeJobs.status),
  ]);

  const modules = Object.fromEntries(
    ANALYSIS_MODULES.map((module) => [
      module,
      {
        threshold: thresholds[module],
        total: 0,
        flagged: 0,
        risk: { low: 0, medium: 0, high: 0 },
        // Statusy tylko flagowanych — to kolejka pracy analityka.
        status: { new: 0, in_review: 0, postponed: 0, confirmed: 0, dismissed: 0 },
      },
    ]),
  ) as Record<
    AnalysisModule,
    {
      threshold: number;
      total: number;
      flagged: number;
      risk: Record<"low" | "medium" | "high", number>;
      status: Record<ReviewStatus, number>;
    }
  >;
  for (const row of resultRows) {
    const target = modules[row.module];
    target.total += row.n;
    target.risk[row.risk] += row.n;
    if (row.risk !== "low") {
      target.flagged += row.n;
      target.status[row.status] += row.n;
    }
  }

  return {
    sources: {
      total: sourceRows.reduce((sum, row) => sum + row.n, 0),
      active: sourceRows.find((row) => row.active)?.n ?? 0,
    },
    materials: {
      total: materialRows.reduce((sum, row) => sum + row.n, 0),
      analyzed: materialRows.reduce((sum, row) => sum + row.analyzed, 0),
      byPlatform: Object.fromEntries(materialRows.map((row) => [row.platform, row.n])),
    },
    modules,
    jobsLast24h: Object.fromEntries(jobRows.map((row) => [row.status, row.n])),
  };
}

// Histogram score × etykieta analityka dla panelu kalibracji (@/lib/analysis/calibration).
export async function scoreHistogram(db: Db, module: AnalysisModule): Promise<ScoreBucket[]> {
  const bucket = sql<number>`least(100, greatest(0, floor(${analysisResults.score} * 100 + 1e-6)))::int`;
  const rows = await db
    .select({
      bucket,
      positive: sql<number>`count(*) filter (where ${analysisResults.status} = 'confirmed')::int`,
      negative: sql<number>`count(*) filter (where ${analysisResults.status} = 'dismissed')::int`,
      // Odłożony = bez decyzji, tak jak nowy i w trakcie.
      unlabeled: sql<number>`count(*) filter (where ${inArray(analysisResults.status, [...UNDECIDED_STATUSES])})::int`,
    })
    .from(analysisResults)
    .where(eq(analysisResults.module, module))
    .groupBy(bucket);
  return rows;
}
