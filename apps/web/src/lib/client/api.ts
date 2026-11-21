"use client";

import type { AnalysisModule, Platform, ReviewStatus, ScrapeJobStatus } from "@app/db";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleThreshold, ThresholdSettings } from "@/lib/analysis/modules";
import { withBasePath } from "@/lib/base-path";
import type { Calibration, IncidentDetail, IncidentList, Trend } from "@/lib/incidents/contract";

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
  return (await response.json()) as T;
}

export type IncidentFilters = {
  module?: AnalysisModule[];
  platform?: Platform[];
  status?: ReviewStatus[];
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
  trend: (from: string) => ["trend", from] as const,
  calibration: (module: AnalysisModule, threshold: number) =>
    ["calibration", module, threshold] as const,
  sources: ["sources"] as const,
};

export function useIncidents(filters: IncidentFilters, enabled = true) {
  return useQuery({
    queryKey: keys.incidents(filters),
    queryFn: () => request<IncidentList>(incidentsPath(filters)),
    enabled,
    staleTime: 15_000,
  });
}

export function useIncident(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.incident(id),
    queryFn: () => request<IncidentDetail>(`/api/incidents/${encodeURIComponent(id)}`),
    enabled: enabled && id.length > 0,
  });
}

export function useThresholds() {
  return useQuery({
    queryKey: keys.thresholds,
    queryFn: () => request<ThresholdSettings>("/api/settings/threshold"),
  });
}

export function useTrend(from: string) {
  return useQuery({
    queryKey: keys.trend(from),
    queryFn: () => request<Trend>(`/api/stats/trend?from=${encodeURIComponent(from)}`),
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
    mutationFn: ({ id, status }: { id: string; status: ReviewStatus }) =>
      request<IncidentDetail>(`/api/incidents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
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
