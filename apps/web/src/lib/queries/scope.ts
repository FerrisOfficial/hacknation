import "server-only";
import { analysisResults, type SQL, sql } from "@app/db";
import { KNF_SCOPED_MODULES } from "@/lib/analysis/knf-scope";

// Warunek SQL do `inKnfScope` (@/lib/analysis/knf-scope): wyniki M1 i M2 tylko dla podmiotu
// z wpisem w rejestrze KNF. Działa też na wierszach zapisanych przed odcięciem w pipeline
// (stary kształt `details`: `entity.registered`). `module`/`details` z aliasem dla podzapytań.
export function knfScopeSql(
  module: SQL | typeof analysisResults.module = sql`${analysisResults.module}`,
  details: SQL | typeof analysisResults.details = sql`${analysisResults.details}`,
): SQL {
  const scoped = sql.join(
    KNF_SCOPED_MODULES.map((m) => sql`${m}`),
    sql`, `,
  );
  return sql`(${module}::text not in (${scoped}) or coalesce(${details} #>> '{entity,in_register}', ${details} #>> '{entity,registered}') = 'true')`;
}
