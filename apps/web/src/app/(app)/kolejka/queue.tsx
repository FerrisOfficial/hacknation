"use client";

import type { AnalysisModule, Platform } from "@app/db";
import {
  ArrowRight,
  Boxes,
  Calendar,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Gauge,
  RadioTower,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlatformLabel } from "@/components/iw/icons";
import { RegistryChip } from "@/components/iw/registry";
import {
  Avatar,
  Chip,
  EmptyState,
  ErrorNote,
  FilterSelect,
  Kbd,
  PageHeader,
  ScoreCell,
  Skeleton,
  StatusTip,
  Tabs,
  Tip,
} from "@/components/iw/ui";
import type { ThresholdSettings } from "@/lib/analysis/modules";
import { useIncidents, useThresholds } from "@/lib/client/api";
import type { UiListItem } from "@/lib/client/contract-ui";
import {
  ACTIVE_PLATFORMS,
  fmtRelative,
  MODULE_SHORT,
  PLATFORM_LABEL,
  plural,
  reviewText,
} from "@/lib/client/format";
import { useHotkeys } from "@/lib/client/hotkeys";
import {
  buildQueue,
  materialTitle,
  type QueueGroup,
  type QueueParams,
  type QueueView,
  queueFilters,
  queueSearch,
  readQueueParams,
} from "@/lib/client/queue";
import { useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

function Row({
  item,
  thresholds,
  href,
  focused,
  fresh,
  onFocus,
}: {
  item: UiListItem;
  thresholds: ThresholdSettings;
  href: string;
  focused: boolean;
  fresh: boolean;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus({ preventScroll: false });
  }, [focused]);
  const muted = item.status === "dismissed" || item.status === "postponed";
  const decided = item.status !== "new";
  const threshold = thresholds[item.module];
  return (
    <li
      className={cn(
        "group relative flex min-h-14 items-center rounded-md transition-colors duration-150 hover:bg-surface-hover",
        fresh && "iw-new-row",
      )}
    >
      <Link
        ref={ref}
        href={href}
        onFocus={onFocus}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-md py-2 pr-2 pl-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-inset"
      >
        <StatusTip review={item} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate font-medium text-sm",
              muted ? "text-ink-500" : "text-ink-900",
            )}
          >
            {materialTitle(item)}
          </span>
          <span className="block truncate text-[13px] text-ink-600">
            {PLATFORM_LABEL[item.platform]} · wykryto {fmtRelative(item.created_at)}
            {fresh ? " · alert na żywo" : ""}
            {decided && (item.reviewed_by || item.reviewed_at)
              ? ` · ${reviewText(item)}${item.review_note ? `: ${item.review_note}` : ""}`
              : ""}
          </span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <Tip label="Kopiuj URL">
          <button
            type="button"
            aria-label="Kopiuj URL"
            onClick={() => {
              void navigator.clipboard.writeText(item.url);
              toast.success("Skopiowano adres materiału");
            }}
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-line-200 hover:text-ink-900"
          >
            <Copy className="size-4" strokeWidth={1.5} />
          </button>
        </Tip>
        <Tip label="Otwórz oryginał">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Otwórz oryginał"
            className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-line-200 hover:text-ink-900"
          >
            <ExternalLink className="size-4" strokeWidth={1.5} />
          </a>
        </Tip>
      </span>
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="flex shrink-0 items-center gap-4 self-stretch py-2 pr-4 pl-3"
      >
        <span className="flex w-5 justify-center">
          {item.reviewed_by ? <Avatar reviewer={item.reviewed_by} /> : null}
        </span>
        <Chip>{MODULE_SHORT[item.module]}</Chip>
        <PlatformLabel platform={item.platform} className="w-[104px] text-[13px]" />
        <ScoreCell score={item.score} flag={threshold.flag} alert={threshold.alert} />
      </Link>
    </li>
  );
}

function Group({
  group,
  view,
  children,
}: {
  group: QueueGroup;
  view: QueueView;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const n = group.items.length;
  const count =
    view === "otwarte"
      ? `${n} ${plural(n, "otwarty", "otwarte", "otwartych")}`
      : `${n} ${plural(n, "materiał", "materiały", "materiałów")}`;
  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-9 items-center gap-2 rounded-md bg-surface-1 pr-3 pl-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Zwiń ${group.name}` : `Rozwiń ${group.name}`}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-600 hover:bg-surface-hover"
        >
          {open ? (
            <ChevronDown className="size-4" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={1.5} />
          )}
        </button>
        <h2 className="font-semibold text-ink-900 text-sm">{group.name}</h2>
        <RegistryChip
          entity={{ in_register: group.inRegister, knf_id: null, on_warning_list: null }}
        />
        <span className="text-[13px] text-ink-600">
          {count} · {group.publishers}{" "}
          {plural(group.publishers, "publikujący", "publikujących", "publikujących")}
        </span>
        {group.hasFirm ? (
          <Link
            href={`/podmiot?nazwa=${encodeURIComponent(group.name)}`}
            className="ml-auto inline-flex items-center gap-1 font-medium text-[13px] text-primary-700 hover:underline"
          >
            Widok podmiotu
            <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {open ? <ul className="flex flex-col">{children}</ul> : null}
    </section>
  );
}

function useViewCounts(params: QueueParams) {
  const open = useIncidents({ ...queueFilters(params, "otwarte"), page_size: 1 });
  const postponed = useIncidents({ ...queueFilters(params, "odlozone"), page_size: 1 });
  const confirmed = useIncidents({ ...queueFilters(params, "potwierdzone"), page_size: 1 });
  const dismissed = useIncidents({ ...queueFilters(params, "falszywe"), page_size: 1 });
  return {
    otwarte: open.data?.total,
    odlozone: postponed.data?.total,
    potwierdzone: confirmed.data?.total,
    falszywe: dismissed.data?.total,
  };
}

export function Queue() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = readQueueParams(search);
  const thresholds = useThresholds();
  const list = useIncidents(queueFilters(params));
  const counts = useViewCounts(params);
  const { alertIds } = useRealtime();
  const [focus, setFocus] = useState(-1);

  const groups = buildQueue(list.data?.items ?? [], params, thresholds.data);
  const flat = groups.flatMap((group) => group.items);
  const suffix = queueSearch(params);

  function update(next: Partial<QueueParams>) {
    router.replace(`${pathname}${queueSearch({ ...params, ...next })}`, { scroll: false });
    setFocus(-1);
  }

  useHotkeys({
    j: () => setFocus((index) => Math.min(flat.length - 1, index + 1)),
    k: () => setFocus((index) => Math.max(0, index - 1)),
    Enter: () => {
      const item = flat[focus] ?? flat[0];
      if (item) router.push(`/kolejka/${item.id}${suffix}`);
    },
  });

  const moduleOptions: { value: AnalysisModule | "wszystkie"; label: string }[] = [
    { value: "wszystkie", label: "wszystkie" },
    { value: "finfluencer", label: "1" },
    { value: "risk_disclosure", label: "2" },
    { value: "unauthorized_advisory", label: "3" },
  ];
  const platformOptions: { value: Platform | "wszystkie"; label: string }[] = [
    { value: "wszystkie", label: "wszystkie" },
    ...ACTIVE_PLATFORMS.map((platform) => ({ value: platform, label: PLATFORM_LABEL[platform] })),
  ];

  let index = -1;
  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
      <PageHeader
        title="Kolejka"
        description="Pogrupowane po podmiocie · najwyższe ryzyko na górze"
        actions={
          <span className="flex items-center gap-2 text-[13px] text-ink-600">
            <Kbd>Enter</Kbd> otwórz <Kbd>J</Kbd> następny <Kbd>K</Kbd> poprzedni
          </span>
        }
      />

      <Tabs
        label="Widok Kolejki"
        className="border-line-200 border-b"
        value={params.view}
        onChange={(view) => update({ view })}
        tabs={[
          { value: "otwarte", label: "Otwarte", count: counts.otwarte },
          { value: "odlozone", label: "Odłożone", count: counts.odlozone },
          { value: "potwierdzone", label: "Potwierdzone", count: counts.potwierdzone },
          { value: "falszywe", label: "Fałszywe alarmy", count: counts.falszywe },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          icon={<Calendar className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Data"
          value={params.date}
          allValue="wszystko"
          onChange={(date) => update({ date })}
          options={[
            { value: "wszystko", label: "wszystkie" },
            { value: "7", label: "ostatnie 7 dni" },
            { value: "30", label: "ostatnie 30 dni" },
          ]}
        />
        <FilterSelect
          icon={<RadioTower className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Źródło"
          value={params.platform}
          allValue="wszystkie"
          onChange={(platform) => update({ platform })}
          options={platformOptions}
        />
        <FilterSelect
          icon={<Gauge className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Ryzyko"
          value={params.risk}
          allValue="wszystkie"
          onChange={(risk) => update({ risk })}
          options={[
            { value: "wszystkie", label: "wszystkie" },
            { value: "wysokie", label: "wysokie" },
          ]}
        />
        <FilterSelect
          icon={<Boxes className="size-3.5" strokeWidth={1.5} aria-hidden="true" />}
          label="Moduł"
          value={params.module}
          allValue="wszystkie"
          onChange={(module) => update({ module })}
          options={moduleOptions}
        />
      </div>

      {list.error ? <ErrorNote error={list.error} /> : null}

      {!list.data || !thresholds.data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : flat.length === 0 ? (
        <EmptyState
          illustration="rodo"
          title={params.view === "otwarte" ? "Wszystko przejrzane" : "Brak materiałów w tym widoku"}
        >
          {params.view === "otwarte"
            ? "Nowe materiały powyżej progu pojawią się tutaj same."
            : "Zmień filtry albo zakładkę."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <Group key={group.key} group={group} view={params.view}>
              {group.items.map((item) => {
                index += 1;
                const position = index;
                return (
                  <Row
                    key={item.id}
                    item={item}
                    thresholds={thresholds.data}
                    href={`/kolejka/${item.id}${suffix}`}
                    focused={focus === position}
                    fresh={alertIds.has(item.id)}
                    onFocus={() => setFocus(position)}
                  />
                );
              })}
            </Group>
          ))}
          <p className="text-[13px] text-ink-600">
            Pokazano {flat.length} z {list.data.total}
            {list.data.total > flat.length && params.risk === "wszystkie"
              ? " (lista pokazuje 200 najnowszych)"
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}
