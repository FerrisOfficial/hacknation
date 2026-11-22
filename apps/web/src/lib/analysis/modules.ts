import type { AnalysisModule, Platform, ReviewStatus } from "@app/db";

// Stałe domeny bez importu runtime z @app/db (ten plik trafia też do bundla przeglądarki).
// `satisfies` + test typów niżej pilnują, że listy są zgodne z enumami w schemacie bazy.

export const ANALYSIS_MODULES = [
  "finfluencer",
  "risk_disclosure",
  "unauthorized_advisory",
] as const satisfies readonly AnalysisModule[];

// Moduły oceniane przez model AI (POST /analyze). Moduł 1 (finfluencer) liczą reguły w backendzie.
export const AI_MODULES = [
  "risk_disclosure",
  "unauthorized_advisory",
] as const satisfies readonly AnalysisModule[];

export const REVIEW_STATUSES = [
  "new",
  "in_review",
  "postponed",
  "confirmed",
  "dismissed",
] as const satisfies readonly ReviewStatus[];

// Statusy bez decyzji analityka: kalibracja nie liczy ich do TP/FP/FN/TN.
export const UNDECIDED_STATUSES = [
  "new",
  "in_review",
  "postponed",
] as const satisfies readonly ReviewStatus[];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  new: "Nowy",
  in_review: "W trakcie",
  postponed: "Odłożony",
  confirmed: "Potwierdzony",
  dismissed: "Fałszywy alarm",
};

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

// Domyślny próg `alert` — od niego leci powiadomienie `incident.high_risk` (docs/KONTRAKT.md §8, §10).
export const DEFAULT_ALERT_THRESHOLD = 0.85;

// Progi `flag` per moduł — tym operują listy, statystyki i raporty.
export type Thresholds = Record<AnalysisModule, number>;

// Pełne ustawienia progów z panelu kalibracji (GET/PUT /api/settings/threshold).
export type ModuleThreshold = { flag: number; alert: number };
export type ThresholdSettings = Record<AnalysisModule, ModuleThreshold>;

export const DEFAULT_THRESHOLD_SETTINGS: ThresholdSettings = {
  finfluencer: { flag: DEFAULT_THRESHOLD, alert: DEFAULT_ALERT_THRESHOLD },
  risk_disclosure: { flag: DEFAULT_THRESHOLD, alert: DEFAULT_ALERT_THRESHOLD },
  unauthorized_advisory: { flag: DEFAULT_THRESHOLD, alert: DEFAULT_ALERT_THRESHOLD },
};

export function flagThresholds(settings: ThresholdSettings): Thresholds {
  return {
    finfluencer: settings.finfluencer.flag,
    risk_disclosure: settings.risk_disclosure.flag,
    unauthorized_advisory: settings.unauthorized_advisory.flag,
  };
}

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
