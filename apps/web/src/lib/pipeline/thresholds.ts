import "server-only";
import {
  type AnalysisModule,
  analysisResults,
  type Db,
  moduleSettings,
  type SQL,
  sql,
} from "@app/db";
import {
  ANALYSIS_MODULES,
  DEFAULT_THRESHOLD_SETTINGS,
  flagThresholds,
  type ModuleThreshold,
  type ThresholdSettings,
  type Thresholds,
} from "@/lib/analysis/modules";
import { RISK_DECAY } from "@/lib/analysis/risk";

type Reader = Pick<Db, "select">;

// `real` w Postgresie to float4 — 0.6 wraca jako 0.6000000238. Do API oddajemy wartość z UI.
function roundThreshold(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Progi `flag` i `alert` wszystkich modułów (docs/KONTRAKT.md §8).
export async function getThresholdSettings(db: Reader): Promise<ThresholdSettings> {
  const settings = structuredClone(DEFAULT_THRESHOLD_SETTINGS);
  const rows = await db.select().from(moduleSettings);
  for (const row of rows) {
    settings[row.module] = {
      flag: roundThreshold(row.threshold),
      alert:
        row.alertThreshold === null
          ? DEFAULT_THRESHOLD_SETTINGS[row.module].alert
          : roundThreshold(row.alertThreshold),
    };
  }
  return settings;
}

// Same progi `flag` — tym operują listy, statystyki, raporty i kalibracja.
export async function getThresholds(db: Reader): Promise<Thresholds> {
  return flagThresholds(await getThresholdSettings(db));
}

// Zapis progów z panelu kalibracji. Moduły pominięte w `update` zostają bez zmian.
export async function saveThresholdSettings(
  db: Db,
  update: Partial<Record<AnalysisModule, ModuleThreshold>>,
): Promise<ThresholdSettings> {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const module of ANALYSIS_MODULES) {
      const value = update[module];
      if (!value) continue;
      await tx
        .insert(moduleSettings)
        .values({ module, threshold: value.flag, alertThreshold: value.alert, updatedAt: now })
        .onConflictDoUpdate({
          target: moduleSettings.module,
          set: { threshold: value.flag, alertThreshold: value.alert, updatedAt: now },
        });
    }
  });
  return getThresholdSettings(db);
}

// Próg modułu danego wiersza `analysis_results` jako wyrażenie SQL (CASE po module). Rzutowanie na
// real: score jest float4, więc porównanie 0.6::real >= 0.6::real musi być w tym samym typie.
export function thresholdSql(thresholds: Thresholds): SQL<number> {
  const cases = (Object.keys(thresholds) as AnalysisModule[]).map(
    (module) => sql`when ${module} then ${thresholds[module]}::real`,
  );
  return sql<number>`(case ${analysisResults.module}::text ${sql.join(cases, sql` `)} end)`;
}

// Risk score (@/lib/analysis/risk) w SQL: reguły z `details.flags` o score ≥ próg modułu,
// od najwyższego, risk = 1 − Π(1 − s_k · 0,5^k). Bez score'ów reguł (M1, M3, starsze wyniki) — score.
export function riskScoreSql(thresholds: Thresholds): SQL<number> {
  return sql<number>`coalesce((
    select 1 - exp(sum(ln(greatest(1 - ranked.s * power(${RISK_DECAY}::float8, ranked.rn - 1), 1e-9))))
    from (
      select (flag->>'score')::float8 as s,
        row_number() over (order by (flag->>'score')::float8 desc) as rn
      from jsonb_array_elements(coalesce(${analysisResults.details}->'flags', '[]'::jsonb)) as flag
      where jsonb_typeof(flag->'score') = 'number'
        and (flag->>'score')::float8 >= ${thresholdSql(thresholds)}
    ) as ranked
  ), case when exists (
    select 1 from jsonb_array_elements(coalesce(${analysisResults.details}->'flags', '[]'::jsonb)) as flag
    where jsonb_typeof(flag->'score') = 'number'
  ) then 0 else ${analysisResults.score} end)::float8`;
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
