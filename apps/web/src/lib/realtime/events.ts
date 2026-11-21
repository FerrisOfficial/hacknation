import type { AnalysisModule, ReviewStatus, ScrapeJobStatus } from "@app/db";
import type { RiskLevel, Thresholds } from "@/lib/analysis/modules";

// Zdarzenia czasu rzeczywistego (Socket.io). Nazwa zdarzenia w Socket.io = pole `type`.
// Ten plik importuje też przeglądarka (typy dla `socket.on(...)`), więc bez kodu serwerowego.

export type AlertEvent = {
  type: "alert";
  resultId: string;
  materialId: string;
  module: AnalysisModule;
  score: number;
  threshold: number;
  riskLevel: Exclude<RiskLevel, "low">;
  label: string;
  title: string | null;
  url: string;
  author: string | null;
  detectedAt: string;
};

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

export type ThresholdsEvent = { type: "thresholds"; thresholds: Thresholds };

export type RealtimeEvent = AlertEvent | JobEvent | ResultEvent | ThresholdsEvent;

// Kanał Postgres LISTEN/NOTIFY: kto zapisuje do bazy, ten publikuje (worker, route handler),
// a serwer Socket.io słucha i rozsyła do przeglądarek. Działa też między procesami/kontenerami.
export const EVENTS_CHANNEL = "investwatch_events";

// Domyślny port serwera Socket.io (REALTIME_PORT w env serwera).
export const DEFAULT_REALTIME_PORT = 3001;
