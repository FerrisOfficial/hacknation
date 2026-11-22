import type { AnalysisModule } from "@app/db";
import type { IncidentEntity } from "@/lib/incidents/contract";

// Moduły 1 i 2 dotyczą reklam firm inwestycyjnych zarejestrowanych w KNF (docs/ZADANIE.md).
// Materiał, którego podmiot nie ma wpisu w rejestrze usług inwestycyjnych KNF (`in_register`
// false albo null), nie jest dla nich incydentem: nie analizujemy go i nie pokazujemy. Moduł 3
// szuka właśnie podmiotów bez zezwolenia, więc go to nie dotyczy.
export const KNF_SCOPED_MODULES = [
  "finfluencer",
  "risk_disclosure",
] as const satisfies readonly AnalysisModule[];

export function requiresKnfRegister(module: AnalysisModule): boolean {
  return (KNF_SCOPED_MODULES as readonly AnalysisModule[]).includes(module);
}

export function inKnfScope(
  module: AnalysisModule,
  entity: Pick<IncidentEntity, "in_register">,
): boolean {
  return !requiresKnfRegister(module) || entity.in_register === true;
}
