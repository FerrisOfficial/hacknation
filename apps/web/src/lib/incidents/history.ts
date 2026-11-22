import type { IncidentEventKind, ReviewStatus } from "@app/db";
import { STATUS_LABELS } from "@/lib/analysis/modules";
import type { HistoryEntry } from "./contract";

// Opisy zdarzeń w historii incydentu (docs/KONTRAKT.md §5, „Zmiany dla UI”). Tekst trafia do bazy
// (`incident_events.action`) w chwili zdarzenia, więc pokazuje próg, który wtedy obowiązywał.

// Wynik pipeline'u dla jednego modułu względem poprzedniej analizy tego materiału.
export type ScoreChange = {
  score: number;
  // undefined = pierwsza analiza materiału w tym module.
  before: number | undefined;
  flag: number;
  alert: number;
};

export type SystemEvent = { kind: Exclude<IncidentEventKind, "status">; action: string };

export function formatScore(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

// Zdarzenia systemu po zapisie wyniku: oflagowanie (wynik przekroczył próg `flag`), alert
// (przekroczył `alert`) albo ponowna analiza incydentu, która zmieniła score.
export function systemEvents({ score, before, flag, alert }: ScoreChange): SystemEvent[] {
  const events: SystemEvent[] = [];
  const crossedFlag = score >= flag && (before === undefined || before < flag);
  if (crossedFlag) {
    events.push({
      kind: "flagged",
      action: `oflagowano ${formatScore(score)} przy progu ${formatScore(flag)}`,
    });
  } else if (
    before !== undefined &&
    (score >= flag || before >= flag) &&
    formatScore(score) !== formatScore(before)
  ) {
    const below = score < flag ? ` (poniżej progu ${formatScore(flag)})` : "";
    events.push({
      kind: "reanalyzed",
      action: `ponowna analiza: ${formatScore(before)} → ${formatScore(score)}${below}`,
    });
  }
  if (score >= alert && (before === undefined || before < alert)) {
    events.push({
      kind: "alert",
      action: `alert: wysokie ryzyko ${formatScore(score)} przy progu alertu ${formatScore(alert)}`,
    });
  }
  return events;
}

// Opis zmiany statusu przez analityka, np. „Odłożony: dowód niepełny”.
export function statusAction(status: ReviewStatus, note: string | null): string {
  if (status === "in_review") return "otwarto";
  if (status === "new") return "przywrócono jako nowy";
  return note ? `${STATUS_LABELS[status]}: ${note}` : STATUS_LABELS[status];
}

// Historia od najnowszego. Wyniki oflagowane przed wprowadzeniem historii nie mają zdarzenia
// `flagged` — dokładamy je z daty wykrycia, bez progu, bo nie wiemy, jaki wtedy obowiązywał.
export function withDetection(
  events: (HistoryEntry & { kind: IncidentEventKind })[],
  detection: { at: string; score: number },
): HistoryEntry[] {
  const entries: HistoryEntry[] = events.map(({ kind: _kind, ...entry }) => entry);
  if (!events.some((event) => event.kind === "flagged")) {
    entries.push({
      at: detection.at,
      actor: null,
      action: `oflagowano ${formatScore(detection.score)}`,
      status: null,
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
