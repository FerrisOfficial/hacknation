import type { AnalysisModule, Platform } from "@app/db";
import { PLATFORMS, type ThresholdSettings } from "@/lib/analysis/modules";
import type { IncidentFilters } from "./api";
import type { UiListItem, UiStatus } from "./contract-ui";
import { daysAgoIso, hostOf, MODULE_BY_NUMBER } from "./format";

// Stan Kolejki w adresie (?widok=&data=&platforma=&ryzyko=&modul=). Okno sprawy dostaje te same
// parametry, więc J/K przechodzi po tej samej liście co Kolejka.

export type QueueView = "otwarte" | "odlozone" | "potwierdzone" | "falszywe";
export type QueueDate = "7" | "30" | "wszystko";
export type QueueRisk = "wszystkie" | "wysokie";
export type QueueSort = "ryzyko" | "najnowsze" | "najstarsze";
export type QueueGrouping = "podmiot" | "brak";

export const VIEW_STATUSES: Record<QueueView, UiStatus[]> = {
  otwarte: ["new", "in_review"],
  odlozone: ["postponed"],
  potwierdzone: ["confirmed"],
  falszywe: ["dismissed"],
};

export type QueueParams = {
  view: QueueView;
  date: QueueDate;
  platform: Platform | "wszystkie";
  risk: QueueRisk;
  sort: QueueSort;
  grouping: QueueGrouping;
  // „naruszenia” (domyślnie) = M2, M3 i M1 z sygnałem naruszenia (R18).
  module: AnalysisModule | "wszystkie" | "naruszenia";
};

type Readable = { get(name: string): string | null };

export function readQueueParams(params: Readable): QueueParams {
  const view = params.get("widok");
  const date = params.get("data");
  const platform = params.get("platforma");
  const risk = params.get("ryzyko");
  const module = MODULE_BY_NUMBER[params.get("modul") ?? ""];
  return {
    view: view === "potwierdzone" || view === "falszywe" || view === "odlozone" ? view : "otwarte",
    date: date === "7" || date === "30" ? date : "wszystko",
    platform: PLATFORMS.find((value) => value === platform) ?? "wszystkie",
    risk: risk === "wysokie" ? "wysokie" : "wszystkie",
    sort:
      params.get("sort") === "najnowsze" || params.get("sort") === "najstarsze"
        ? (params.get("sort") as QueueSort)
        : "ryzyko",
    grouping: params.get("grupuj") === "brak" ? "brak" : "podmiot",
    module: module ?? (params.get("modul") === "wszystkie" ? "wszystkie" : "naruszenia"),
  };
}

export function queueFilters(params: QueueParams, view: QueueView = params.view): IncidentFilters {
  return {
    status: VIEW_STATUSES[view],
    module:
      params.module === "wszystkie" || params.module === "naruszenia" ? undefined : [params.module],
    platform: params.platform === "wszystkie" ? undefined : [params.platform],
    from: params.date === "wszystko" ? undefined : daysAgoIso(Number(params.date) - 1),
    page_size: 200,
  };
}

export type QueueGroup = {
  key: string;
  name: string;
  hasFirm: boolean;
  inRegister: boolean | null;
  items: UiListItem[];
  maxScore: number;
  publishers: number;
};

export function entityName(item: Pick<UiListItem, "firm_name" | "advertiser">): string | null {
  return item.firm_name ?? item.advertiser ?? null;
}

export function materialTitle(item: Pick<UiListItem, "advertiser" | "url" | "summary" | "title">) {
  if (item.title) return item.advertiser ? `${item.advertiser}: „${item.title}”` : item.title;
  const who = item.advertiser ?? hostOf(item.url);
  return item.summary ? `${who}: „${item.summary}”` : who;
}

// Moduł 1 to wykryta reklama, nie naruszenie (R18). Do Kolejki naruszeń trafia tylko z sygnałem:
// reklamowana firma jest spoza rejestru KNF albo na liście ostrzeżeń publicznych KNF.
export function isEscalated(
  item: Pick<UiListItem, "module" | "in_register" | "on_warning_list">,
): boolean {
  return (
    item.module === "finfluencer" && (item.in_register === false || item.on_warning_list === true)
  );
}

export function isViolationItem(
  item: Pick<UiListItem, "module" | "in_register" | "on_warning_list">,
): boolean {
  return item.module !== "finfluencer" || isEscalated(item);
}

export function escalationText(item: Pick<UiListItem, "in_register" | "on_warning_list">): string {
  return item.on_warning_list
    ? "firma z listy ostrzeżeń KNF"
    : "firma spoza rejestru KNF: możliwa reklama usług bez zezwolenia";
}

// Pogrupowane po podmiocie, najwyższe ryzyko na górze (R1). Ryzyko „wysokie” = score ≥ próg alertu.
export function buildQueue(
  items: UiListItem[],
  params: QueueParams,
  thresholds: ThresholdSettings | undefined,
): QueueGroup[] {
  const scoped = params.module === "naruszenia" ? items.filter(isViolationItem) : items;
  const filtered =
    params.risk === "wysokie" && thresholds
      ? scoped.filter(
          (item) => item.module !== "finfluencer" && item.score >= thresholds[item.module].alert,
        )
      : scoped;
  const groups = new Map<string, QueueGroup>();
  for (const item of filtered) {
    const name = entityName(item);
    const key = name ?? "__bez_podmiotu";
    const group = groups.get(key) ?? {
      key,
      name: name ?? "Bez rozpoznanego podmiotu",
      hasFirm: Boolean(item.firm_name),
      inRegister: item.in_register ?? null,
      items: [],
      maxScore: 0,
      publishers: 0,
    };
    group.items.push(item);
    group.maxScore = Math.max(group.maxScore, item.score);
    groups.set(key, group);
  }
  const compare = sorter(params.sort);
  const result = [...groups.values()];
  for (const group of result) {
    group.items.sort(compare);
    group.publishers = new Set(group.items.map((item) => item.advertiser ?? item.url)).size;
  }
  if (params.grouping === "brak") {
    const all = result.flatMap((group) => group.items).sort(compare);
    return all.length
      ? [
          {
            key: "__wszystkie",
            name: "",
            hasFirm: false,
            inRegister: null,
            items: all,
            maxScore: Math.max(...all.map(priority)),
            publishers: new Set(all.map((item) => item.advertiser ?? item.url)).size,
          },
        ]
      : [];
  }
  // Grupy ustawia pierwszy materiał grupy w wybranym porządku.
  return result.sort((a, b) => {
    const first = a.items[0];
    const second = b.items[0];
    return first && second ? compare(first, second) : 0;
  });
}

// Priorytet przeglądu: risk_score (M2 liczy go z naruszeń ponad progiem), inaczej score.
function priority(item: UiListItem): number {
  return item.risk_score ?? item.score;
}

function sorter(sort: QueueSort): (a: UiListItem, b: UiListItem) => number {
  if (sort === "najnowsze") return (a, b) => b.created_at.localeCompare(a.created_at);
  if (sort === "najstarsze") return (a, b) => a.created_at.localeCompare(b.created_at);
  return (a, b) => priority(b) - priority(a) || b.created_at.localeCompare(a.created_at);
}

export function queueSearch(params: QueueParams): string {
  const search = new URLSearchParams();
  if (params.view !== "otwarte") search.set("widok", params.view);
  if (params.date !== "wszystko") search.set("data", params.date);
  if (params.platform !== "wszystkie") search.set("platforma", params.platform);
  if (params.risk !== "wszystkie") search.set("ryzyko", params.risk);
  if (params.sort !== "ryzyko") search.set("sort", params.sort);
  if (params.grouping !== "podmiot") search.set("grupuj", params.grouping);
  if (params.module === "wszystkie") search.set("modul", "wszystkie");
  else if (params.module !== "naruszenia") {
    search.set(
      "modul",
      params.module === "finfluencer" ? "1" : params.module === "risk_disclosure" ? "2" : "3",
    );
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
