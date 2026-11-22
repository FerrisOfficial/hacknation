"use client";

import { Calendar, Download, ListChecks, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PlatformLabel, StatusGlyph } from "@/components/iw/icons";
import { RegistryChip } from "@/components/iw/registry";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  FilterSelect,
  PageHeader,
  ScoreCell,
  Skeleton,
  Tip,
} from "@/components/iw/ui";
import { useIncidents, useThresholds } from "@/lib/client/api";
import type { UiListItem, UiStatus } from "@/lib/client/contract-ui";
import {
  daysAgoIso,
  fmtDateTime,
  hostOf,
  PLATFORM_LABEL,
  plural,
  reviewText,
  STATUS_LABEL,
  statusLabelFor,
} from "@/lib/client/format";
import { escalationText, isEscalated } from "@/lib/client/queue";
import { cn } from "@/lib/utils";

// Rejestr reklam (Z8, R18): moduł 1 daje UKNF bazę „firma, reklamujący, treść, URL”, a nie listę
// naruszeń. Weryfikacja jest lekka („To reklama” / „To nie reklama”) i odbywa się w Oknie sprawy.

type Check = "bez-odrzuconych" | "do-weryfikacji" | "reklama" | "nie-reklama";
type Range = "7" | "30" | "wszystko";

const CHECK_STATUSES: Record<Check, UiStatus[]> = {
  "bez-odrzuconych": ["new", "in_review", "postponed", "confirmed"],
  "do-weryfikacji": ["new", "in_review", "postponed"],
  reklama: ["confirmed"],
  "nie-reklama": ["dismissed"],
};

type FirmGroup = {
  key: string;
  name: string;
  items: UiListItem[];
  advertisers: number;
  escalated: boolean;
};

function groupByFirm(items: UiListItem[]): FirmGroup[] {
  const groups = new Map<string, FirmGroup>();
  for (const item of items) {
    const name = item.firm_name ?? "Bez rozpoznanej firmy";
    const group = groups.get(name) ?? {
      key: name,
      name,
      items: [],
      advertisers: 0,
      escalated: false,
    };
    group.items.push(item);
    group.escalated ||= isEscalated(item);
    groups.set(name, group);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    group.advertisers = new Set(group.items.map((item) => item.advertiser ?? item.url)).size;
  }
  // Firmy z sygnałem naruszenia na górze, potem według liczby reklam.
  return result.sort(
    (a, b) => Number(b.escalated) - Number(a.escalated) || b.items.length - a.items.length,
  );
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Eksport z tego, co widać po filtrach: plik CSV (średnik, UTF-8 z BOM) otwiera się w Excelu.
function exportCsv(items: UiListItem[]) {
  const header = [
    "firma",
    "w_rejestrze_knf",
    "lista_ostrzezen_knf",
    "reklamujacy",
    "tytul",
    "platforma",
    "url",
    "wykryto",
    "pewnosc",
    "weryfikacja",
  ];
  const rows = items.map((item) => [
    item.firm_name,
    item.in_register,
    item.on_warning_list,
    item.advertiser,
    item.title ?? item.summary,
    PLATFORM_LABEL[item.platform],
    item.url,
    item.created_at,
    item.score.toFixed(2).replace(".", ","),
    statusLabelFor(item.status, "finfluencer"),
  ]);
  const text = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `rejestr-reklam-m1-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function AdRegistry() {
  const [check, setCheck] = useState<Check>("bez-odrzuconych");
  const [range, setRange] = useState<Range>("30");
  const thresholds = useThresholds();
  const list = useIncidents({
    module: ["finfluencer"],
    status: CHECK_STATUSES[check],
    from: range === "wszystko" ? undefined : daysAgoIso(Number(range) - 1),
    page_size: 200,
  });
  const items = list.data?.items ?? [];
  const groups = groupByFirm(items);
  const advertisers = new Set(items.map((item) => item.advertiser ?? hostOf(item.url))).size;
  const escalated = items.filter(isEscalated).length;
  const threshold = thresholds.data?.finfluencer;

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
      <PageHeader
        title="Reklamy osób trzecich"
        description="Rejestr reklam firm inwestycyjnych publikowanych przez finfluencerów i inne podmioty trzecie. Reklama sama w sobie nie jest naruszeniem; ta z sygnałem naruszenia trafia też do Kolejki."
        actions={
          <Button
            variant="primary"
            disabled={!items.length}
            onClick={() => exportCsv(items)}
            icon={<Download className="size-4" strokeWidth={1.5} aria-hidden="true" />}
          >
            Eksportuj CSV ({items.length})
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          icon={<Calendar className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Data"
          value={range}
          allValue="30"
          onChange={setRange}
          options={[
            { value: "7", label: "ostatnie 7 dni" },
            { value: "30", label: "ostatnie 30 dni" },
            { value: "wszystko", label: "wszystkie" },
          ]}
        />
        <FilterSelect
          icon={<ListChecks className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Weryfikacja"
          value={check}
          allValue="bez-odrzuconych"
          onChange={setCheck}
          options={[
            { value: "bez-odrzuconych", label: "bez odrzuconych" },
            { value: "do-weryfikacji", label: "do weryfikacji" },
            { value: "reklama", label: "potwierdzone reklamy" },
            { value: "nie-reklama", label: "to nie reklama" },
          ]}
        />
        {list.data ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <Chip>
              {items.length} {plural(items.length, "reklama", "reklamy", "reklam")}
            </Chip>
            <Chip>
              {groups.length} {plural(groups.length, "firma", "firmy", "firm")}
            </Chip>
            <Chip>
              {advertisers} {plural(advertisers, "reklamujący", "reklamujących", "reklamujących")}
            </Chip>
            {escalated ? (
              <Chip className="bg-warning-100 text-warning-800">
                {escalated} z sygnałem naruszenia
              </Chip>
            ) : null}
          </span>
        ) : null}
      </div>

      {list.error ? <ErrorNote error={list.error} /> : null}
      {!list.data || !threshold ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <EmptyState illustration="megafon" title="Brak reklam w tym widoku">
          Zmień zakres dat albo filtr weryfikacji.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            const first = group.items[0];
            return (
              <Card key={group.key} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-line-200 border-b bg-surface-1 px-4 py-2.5">
                  <h2 className="font-semibold text-ink-900 text-sm">{group.name}</h2>
                  {first ? (
                    <RegistryChip
                      entity={{
                        in_register: first.in_register ?? null,
                        knf_id: null,
                        on_warning_list: first.on_warning_list ?? null,
                      }}
                    />
                  ) : null}
                  <span className="text-[13px] text-ink-600">
                    {group.items.length}{" "}
                    {plural(group.items.length, "reklama", "reklamy", "reklam")} ·{" "}
                    {group.advertisers}{" "}
                    {plural(group.advertisers, "reklamujący", "reklamujących", "reklamujących")}
                  </span>
                  {group.escalated && first ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-[13px] text-warning-800">
                      <TriangleAlert className="size-4" strokeWidth={1.5} aria-hidden="true" />
                      {escalationText(first)}
                    </span>
                  ) : null}
                  {first?.firm_name ? (
                    <Link
                      href={`/podmiot?nazwa=${encodeURIComponent(first.firm_name)}`}
                      className="ml-auto font-medium text-[13px] text-primary-700 hover:underline"
                    >
                      Widok podmiotu
                    </Link>
                  ) : null}
                </div>
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-11" />
                    <col />
                    <col className="w-36" />
                    <col className="w-32" />
                    <col className="w-56" />
                  </colgroup>
                  <thead className="text-left text-ink-600 text-xs">
                    <tr>
                      <th className="w-8 py-2 pl-4 font-medium">
                        <span className="sr-only">Weryfikacja</span>
                      </th>
                      <th className="py-2 pr-3 font-medium">Reklamujący i treść</th>
                      <th className="py-2 pr-3 font-medium">Platforma</th>
                      <th className="py-2 pr-3 font-medium">Wykryto</th>
                      <th className="py-2 pr-4 font-medium">Pewność</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-200">
                    {group.items.map((item) => (
                      <tr key={item.id} className="group hover:bg-surface-hover">
                        <td className="py-2.5 pl-4 align-top">
                          <Tip
                            label={reviewText(item).replace(
                              STATUS_LABEL[item.status],
                              statusLabelFor(item.status, "finfluencer"),
                            )}
                          >
                            <StatusGlyph status={item.status} />
                          </Tip>
                        </td>
                        <td className="max-w-[520px] py-2.5 pr-3">
                          <Link
                            href={`/kolejka/${item.id}?modul=1`}
                            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
                          >
                            <span
                              className={cn(
                                "block truncate font-medium",
                                item.status === "dismissed" ? "text-ink-500" : "text-ink-900",
                              )}
                            >
                              {item.advertiser ?? hostOf(item.url)}
                            </span>
                            <span className="block truncate text-[13px] text-ink-600">
                              {item.title ?? item.summary ?? hostOf(item.url)}
                            </span>
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 align-top">
                          <PlatformLabel platform={item.platform} className="text-[13px]" />
                        </td>
                        <td className="tnum py-2.5 pr-3 align-top text-[13px] text-ink-700">
                          {fmtDateTime(item.created_at)}
                        </td>
                        <td className="py-2.5 pr-4 align-top">
                          <ScoreCell
                            score={item.score}
                            flag={threshold.flag}
                            alert={threshold.alert}
                            confidence
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            );
          })}
          <p className="text-[13px] text-ink-600">
            Pokazano {items.length} z {list.data.total}
            {list.data.total > items.length ? " (rejestr pokazuje 200 najnowszych)" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
