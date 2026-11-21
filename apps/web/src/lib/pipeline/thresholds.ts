import "server-only";
import {
  type AnalysisModule,
  analysisResults,
  type Db,
  moduleSettings,
  type SQL,
  sql,
} from "@app/db";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/analysis/modules";

type Reader = Pick<Db, "select">;

// `real` w Postgresie to float4 — 0.6 wraca jako 0.6000000238. Do API oddajemy wartość z UI.
function roundThreshold(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function getThresholds(db: Reader): Promise<Thresholds> {
  const thresholds = { ...DEFAULT_THRESHOLDS };
  const rows = await db.select().from(moduleSettings);
  for (const row of rows) thresholds[row.module] = roundThreshold(row.threshold);
  return thresholds;
}

export async function setThreshold(
  db: Db,
  module: AnalysisModule,
  threshold: number,
): Promise<Thresholds> {
  await db
    .insert(moduleSettings)
    .values({ module, threshold })
    .onConflictDoUpdate({
      target: moduleSettings.module,
      set: { threshold, updatedAt: new Date() },
    });
  return getThresholds(db);
}

// Próg modułu danego wiersza `analysis_results` jako wyrażenie SQL (CASE po module). Rzutowanie na
// real: score jest float4, więc porównanie 0.6::real >= 0.6::real musi być w tym samym typie.
export function thresholdSql(thresholds: Thresholds): SQL<number> {
  const cases = (Object.keys(thresholds) as AnalysisModule[]).map(
    (module) => sql`when ${module} then ${thresholds[module]}::real`,
  );
  return sql<number>`(case ${analysisResults.module}::text ${sql.join(cases, sql` `)} end)`;
}

// Granica wysokiego ryzyka (zgodnie z riskLevel w @/lib/analysis/modules): (próg + 1) / 2.
export function highRiskSql(thresholds: Thresholds): SQL<number> {
  return sql<number>`((${thresholdSql(thresholds)} + 1) / 2)::real`;
}

export function riskLevelSql(thresholds: Thresholds): SQL<"low" | "medium" | "high"> {
  return sql<"low" | "medium" | "high">`(case
    when ${analysisResults.score} < ${thresholdSql(thresholds)} then 'low'
    when ${analysisResults.score} >= ${highRiskSql(thresholds)} then 'high'
    else 'medium' end)`;
}
