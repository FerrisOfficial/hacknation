"use client";

import type { AnalysisModule, Platform, ScrapeJobStatus } from "@app/db";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleThreshold, ThresholdSettings } from "@/lib/analysis/modules";
import { withBasePath } from "@/lib/base-path";
import type { Calibration, Trend } from "@/lib/incidents/contract";
import type { SourceCreateInput, SourceUpdateInput } from "@/lib/schemas";
import type { Me, UiDetail, UiList, UiStatus } from "./contract-ui";
import { daysAgoIso } from "./format";
import { isViolationItem } from "./queue";

// Klient REST dla dashboardu: docs/KONTRAKT.md §4–§9 oraz /api/sources (poza kontraktem, bez zmian).
// Przeglądarka woła tylko route handlery Next.js, nigdy FastAPI.

async function request<T>(path: `/${string}`, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    let message = `Błąd ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // Odpowiedź bez JSON-a: zostaje kod HTTP.
    }
    throw new Error(message);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export type IncidentFilters = {
  module?: AnalysisModule[];
  platform?: Platform[];
  status?: UiStatus[];
  from?: string;
  to?: string;
  min_score?: number;
  page_size?: number;
};

function incidentsPath(filters: IncidentFilters): `/${string}` {
  const params = new URLSearchParams();
  if (filters.module?.length) params.set("module", filters.module.join(","));
  if (filters.platform?.length) params.set("platform", filters.platform.join(","));
  if (filters.status?.length) params.set("status", filters.status.join(","));
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.min_score !== undefined) params.set("min_score", String(filters.min_score));
  params.set("page_size", String(filters.page_size ?? 200));
  return `/api/incidents?${params.toString()}`;
}

export const keys = {
  incidents: (filters: IncidentFilters) => ["incidents", filters] as const,
  incident: (id: string) => ["incident", id] as const,
  thresholds: ["thresholds"] as const,
  trend: (range: string) => ["trend", range] as const,
  calibration: (module: AnalysisModule, threshold: number) =>
    ["calibration", module, threshold] as const,
  sources: ["sources"] as const,
  me: ["me"] as const,
};

// GET /api/me (zmiana kontraktu dla UI). Bez endpointu nawigacja nie pokazuje użytkownika.
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => request<Me>("/api/me"),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function videoUrl(id: string): string {
  return withBasePath(`/api/incidents/${encodeURIComponent(id)}/video`);
}

export function frameUrl(id: string, file: string): string {
  return withBasePath(
    `/api/incidents/${encodeURIComponent(id)}/frames/${encodeURIComponent(file)}`,
  );
}

// Teczka podmiotu (Z7): potwierdzone materiały z kopiami, dowodami i historią decyzji w ZIP.
export function dossierUrl(firm: string): string {
  return withBasePath(`/api/entities/dossier?firm=${encodeURIComponent(firm)}`);
}

export function useIncidents(filters: IncidentFilters, enabled = true) {
  return useQuery({
    queryKey: keys.incidents(filters),
    queryFn: () => request<UiList>(incidentsPath(filters)),
    enabled,
    staleTime: 15_000,
  });
}

// Liczba incydentów Kolejki naruszeń (R18): M2, M3 i M1 z sygnałem naruszenia. Filtr M1 liczymy
// na kliencie, bo eskalacja zależy od pól podmiotu, więc pobieramy do 200 wierszy zamiast `total`.
export function useViolationCount(filters: IncidentFilters, enabled = true): number | undefined {
  const query = useIncidents({ ...filters, page_size: 200 }, enabled);
  return query.data?.items.filter(isViolationItem).length;
}

export function useIncident(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.incident(id),
    queryFn: () => request<UiDetail>(`/api/incidents/${encodeURIComponent(id)}`),
    enabled: enabled && id.length > 0,
  });
}

export function useThresholds() {
  return useQuery({
    queryKey: keys.thresholds,
    queryFn: () => request<ThresholdSettings>("/api/settings/threshold"),
  });
}

// Zakres wykresu trendu: krótkie („5 min”, „1 h”) w koszykach minutowych, długie w dniach.
export const TREND_RANGES = ["5m", "1h", "7d", "30d"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

const MINUTE_MS = 60_000;
const TREND_QUERY: Record<
  TrendRange,
  { bucket: "minute" | "5min" | "day"; from: (now: Date) => string }
> = {
  "5m": { bucket: "minute", from: (now) => new Date(now.getTime() - 5 * MINUTE_MS).toISOString() },
  "1h": { bucket: "5min", from: (now) => new Date(now.getTime() - 60 * MINUTE_MS).toISOString() },
  "7d": { bucket: "day", from: (now) => daysAgoIso(6, now) },
  "30d": { bucket: "day", from: (now) => daysAgoIso(29, now) },
};

export function useTrend(range: TrendRange) {
  const short = range === "5m" || range === "1h";
  return useQuery({
    queryKey: keys.trend(range),
    // `from` liczony przy każdym pobraniu: krótki zakres przesuwa się z czasem.
    queryFn: () => {
      const { bucket, from } = TREND_QUERY[range];
      const params = new URLSearchParams({ from: from(new Date()), bucket });
      return request<Trend>(`/api/stats/trend?${params.toString()}`);
    },
    refetchInterval: short ? 30_000 : false,
  });
}

export function useCalibration(module: AnalysisModule, threshold: number | undefined) {
  return useQuery({
    queryKey: keys.calibration(module, threshold ?? -1),
    queryFn: () =>
      request<Calibration>(`/api/calibration?module=${module}&threshold=${threshold ?? 0}`),
    enabled: threshold !== undefined,
    placeholderData: (previous) => previous,
  });
}

// Kształt z GET /api/sources (SourceView z @/lib/queries/sources po serializacji do JSON).
export type SourceItem = {
  id: string;
  platform: Platform;
  url: string;
  name: string;
  active: boolean;
  config:
    | { kind: "web_page" }
    | { kind: "youtube_search"; query: string; limit: number; paidOnly: boolean }
    | { kind: "youtube_channel"; channelUrl: string; limit: number };
  intervalMinutes: number | null;
  lastScrapedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  materialsCount: number;
  lastJob: {
    id: string;
    status: ScrapeJobStatus;
    trigger: string;
    createdAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
  nextRunAt: string | null;
};

export function useSources() {
  return useQuery({
    queryKey: keys.sources,
    queryFn: () => request<{ items: SourceItem[] }>("/api/sources"),
    refetchInterval: 60_000,
  });
}

export function sourceHasError(source: SourceItem): boolean {
  return source.active && source.lastJob?.status === "failed";
}

export function invalidateIncidents(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ["incidents"] });
  void client.invalidateQueries({ queryKey: ["incident"] });
  void client.invalidateQueries({ queryKey: ["trend"] });
  void client.invalidateQueries({ queryKey: ["calibration"] });
}

export function useSetStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: UiStatus; note?: string }) =>
      request<UiDetail>(`/api/incidents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(note ? { status, review_note: note } : { status }),
      }),
    onSuccess: (detail) => {
      client.setQueryData(keys.incident(detail.id), detail);
      invalidateIncidents(client);
    },
  });
}

export function useSaveThreshold() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: Partial<Record<AnalysisModule, ModuleThreshold>>) =>
      request<ThresholdSettings>("/api/settings/threshold", {
        method: "PUT",
        body: JSON.stringify(change),
      }),
    onSuccess: (settings) => {
      client.setQueryData(keys.thresholds, settings);
      invalidateIncidents(client);
    },
  });
}

export function useRunSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ status: string; jobId: string }>(`/api/sources/${encodeURIComponent(id)}/run`, {
        method: "POST",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.sources });
    },
  });
}

export function useDeleteSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<null>(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useEngine() {
  return useQuery({
    queryKey: ["engine"],
    queryFn: () => request<{ paused: boolean }>("/api/settings/engine"),
  });
}

export function useSetEngine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) =>
      request<{ paused: boolean }>("/api/settings/engine", {
        method: "PUT",
        body: JSON.stringify({ paused }),
      }),
    onSuccess: (data) => client.setQueryData(["engine"], data),
  });
}

export function useCreateSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceCreateInput) =>
      request<unknown>("/api/sources", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.sources }),
  });
}

export function useUpdateSource() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...change }: { id: string } & SourceUpdateInput) =>
      request<unknown>(`/api/sources/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.sources }),
  });
}
