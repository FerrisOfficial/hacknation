import type { AnalysisModule, Platform, ReviewStatus } from "@app/db";
import { PLATFORMS, type ThresholdSettings } from "@/lib/analysis/modules";
import type { IncidentListItem } from "@/lib/incidents/contract";
import type { IncidentFilters } from "./api";
import { daysAgoIso, hostOf, MODULE_BY_NUMBER } from "./format";

// Stan Kolejki w adresie (?widok=&data=&platforma=&ryzyko=&modul=). Okno sprawy dostaje te same
// parametry, więc J/K przechodzi po tej samej liście co Kolejka.

export type QueueView = "otwarte" | "potwierdzone" | "falszywe";
export type QueueDate = "7" | "30" | "wszystko";
export type QueueRisk = "wszystkie" | "wysokie";

export const VIEW_STATUSES: Record<QueueView, ReviewStatus[]> = {
  otwarte: ["new", "in_review"],
  potwierdzone: ["confirmed"],
  falszywe: ["dismissed"],
};

export type QueueParams = {
  view: QueueView;
  date: QueueDate;
  platform: Platform | "wszystkie";
  risk: QueueRisk;
  module: AnalysisModule | "wszystkie";
};

type Readable = { get(name: string): string | null };

export function readQueueParams(params: Readable): QueueParams {
  const view = params.get("widok");
  const date = params.get("data");
  const platform = params.get("platforma");
  const risk = params.get("ryzyko");
  const module = MODULE_BY_NUMBER[params.get("modul") ?? ""];
  return {
    view: view === "potwierdzone" || view === "falszywe" ? view : "otwarte",
    date: date === "7" || date === "30" ? date : "wszystko",
    platform: PLATFORMS.find((value) => value === platform) ?? "wszystkie",
    risk: risk === "wysokie" ? "wysokie" : "wszystkie",
    module: module ?? "wszystkie",
  };
}

export function queueFilters(params: QueueParams, view: QueueView = params.view): IncidentFilters {
  return {
    status: VIEW_STATUSES[view],
    module: params.module === "wszystkie" ? undefined : [params.module],
    platform: params.platform === "wszystkie" ? undefined : [params.platform],
    from: params.date === "wszystko" ? undefined : daysAgoIso(Number(params.date) - 1),
    page_size: 200,
  };
}

export type QueueGroup = {
  key: string;
  name: string;
  hasFirm: boolean;
  items: IncidentListItem[];
  maxScore: number;
  publishers: number;
};

export function entityName(
  item: Pick<IncidentListItem, "firm_name" | "advertiser">,
): string | null {
  return item.firm_name ?? item.advertiser ?? null;
}

export function materialTitle(item: Pick<IncidentListItem, "advertiser" | "url" | "summary">) {
  const who = item.advertiser ?? hostOf(item.url);
  return item.summary ? `${who}: „${item.summary}”` : who;
}

// Pogrupowane po podmiocie, najwyższe ryzyko na górze (R1). Ryzyko „wysokie” = score ≥ próg alertu.
export function buildQueue(
  items: IncidentListItem[],
  params: QueueParams,
  thresholds: ThresholdSettings | undefined,
): QueueGroup[] {
  const filtered =
    params.risk === "wysokie" && thresholds
      ? items.filter((item) => item.score >= thresholds[item.module].alert)
      : items;
  const groups = new Map<string, QueueGroup>();
  for (const item of filtered) {
    const name = entityName(item);
    const key = name ?? "__bez_podmiotu";
    const group = groups.get(key) ?? {
      key,
      name: name ?? "Bez rozpoznanego podmiotu",
      hasFirm: Boolean(item.firm_name),
      items: [],
      maxScore: 0,
      publishers: 0,
    };
    group.items.push(item);
    group.maxScore = Math.max(group.maxScore, item.score);
    groups.set(key, group);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.items.sort((a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at));
    group.publishers = new Set(group.items.map((item) => item.advertiser ?? item.url)).size;
  }
  return result.sort((a, b) => b.maxScore - a.maxScore);
}

export function queueSearch(params: QueueParams): string {
  const search = new URLSearchParams();
  if (params.view !== "otwarte") search.set("widok", params.view);
  if (params.date !== "wszystko") search.set("data", params.date);
  if (params.platform !== "wszystkie") search.set("platforma", params.platform);
  if (params.risk !== "wszystkie") search.set("ryzyko", params.risk);
  if (params.module !== "wszystkie") {
    search.set(
      "modul",
      params.module === "finfluencer" ? "1" : params.module === "risk_disclosure" ? "2" : "3",
    );
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
