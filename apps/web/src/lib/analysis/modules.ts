import type { AnalysisModule, Platform, ReviewStatus } from "@app/db";

// Stałe domeny bez importu runtime z @app/db (ten plik trafia też do bundla przeglądarki).
// `satisfies` + test typów niżej pilnują, że listy są zgodne z enumami w schemacie bazy.

export const ANALYSIS_MODULES = [
  "finfluencer",
  "risk_disclosure",
  "unauthorized_advisory",
] as const satisfies readonly AnalysisModule[];

export const REVIEW_STATUSES = [
  "new",
  "in_review",
  "confirmed",
  "dismissed",
] as const satisfies readonly ReviewStatus[];

export const PLATFORMS = [
  "web",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "linkedin",
  "telegram",
] as const satisfies readonly Platform[];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

type Missing<All, Listed> = Exclude<All, Listed> extends never ? true : Exclude<All, Listed>;
const modulesComplete: Missing<AnalysisModule, (typeof ANALYSIS_MODULES)[number]> = true;
const statusesComplete: Missing<ReviewStatus, (typeof REVIEW_STATUSES)[number]> = true;
const platformsComplete: Missing<Platform, (typeof PLATFORMS)[number]> = true;
void [modulesComplete, statusesComplete, platformsComplete];

export const MODULE_LABELS: Record<AnalysisModule, string> = {
  finfluencer: "Moduł 1: finfluencerzy i podmioty trzecie",
  risk_disclosure: "Moduł 2: informacja o ryzyku",
  unauthorized_advisory: "Moduł 3: nieautoryzowane doradztwo",
};

// Próg, gdy nikt go jeszcze nie skalibrował (brak wiersza w `module_settings`).
export const DEFAULT_THRESHOLD = 0.5;

export type Thresholds = Record<AnalysisModule, number>;

export const DEFAULT_THRESHOLDS: Thresholds = {
  finfluencer: DEFAULT_THRESHOLD,
  risk_disclosure: DEFAULT_THRESHOLD,
  unauthorized_advisory: DEFAULT_THRESHOLD,
};

// Poziom ryzyka względem progu modułu: poniżej progu — niski (nieflagowany), górna połowa
// przedziału [próg, 1] — wysoki, reszta — średni. Przesunięcie progu w panelu kalibracji
// przesuwa więc też granicę „wysokiego ryzyka”.
export function highRiskFrom(threshold: number): number {
  return (threshold + 1) / 2;
}

export function riskLevel(score: number, threshold: number): RiskLevel {
  if (score < threshold) return "low";
  return score >= highRiskFrom(threshold) ? "high" : "medium";
}
