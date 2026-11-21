import type { AnalysisModule, ReviewStatus, ScrapeJobStatus } from "@app/db";
import type { ThresholdSettings } from "@/lib/analysis/modules";
import type { HighRiskIncidentEvent } from "@/lib/incidents/contract";

// Zdarzenia czasu rzeczywistego (Socket.io). Nazwa zdarzenia w Socket.io = pole `type`.
// Ten plik importuje też przeglądarka (typy dla `socket.on(...)`), więc bez kodu serwerowego.

// Wynik przekroczył próg `alert` swojego modułu (docs/KONTRAKT.md §10). Socket.io wysyła
// zdarzenie `incident.high_risk` z polami { id, module, score, summary, url } — bez `type`.
export type HighRiskEvent = { type: "incident.high_risk" } & HighRiskIncidentEvent;

export type JobEvent = {
  type: "job";
  jobId: string;
  sourceId: string;
  status: ScrapeJobStatus;
  materialsCount: number | null;
  analysisQueued: number | null;
  error: string | null;
};

export type ResultEvent = {
  type: "result";
  resultId: string;
  materialId: string;
  module: AnalysisModule;
  status: ReviewStatus;
};

export type ThresholdsEvent = { type: "thresholds"; thresholds: ThresholdSettings };

export type RealtimeEvent = HighRiskEvent | JobEvent | ResultEvent | ThresholdsEvent;

export const REALTIME_EVENT_TYPES = [
  "incident.high_risk",
  "job",
  "result",
  "thresholds",
] as const satisfies readonly RealtimeEvent["type"][];

// To, co dostaje przeglądarka w `socket.on(nazwa, (payload) => …)`: zdarzenie bez pola `type`.
export type RealtimePayload<T extends RealtimeEvent["type"]> = Omit<
  Extract<RealtimeEvent, { type: T }>,
  "type"
>;

// Kanał Postgres LISTEN/NOTIFY: kto zapisuje do bazy, ten publikuje (worker, route handler),
// a serwer Socket.io słucha i rozsyła do przeglądarek. Działa też między procesami/kontenerami.
export const EVENTS_CHANNEL = "investwatch_events";

// Domyślny port serwera Socket.io (REALTIME_PORT w env serwera).
export const DEFAULT_REALTIME_PORT = 3001;
