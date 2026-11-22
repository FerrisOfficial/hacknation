"use client";

import { ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PlatformLabel, StatusGlyph } from "@/components/iw/icons";
import { RegistryChip } from "@/components/iw/registry";
import {
  Avatar,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  PageHeader,
  ScoreCell,
  SectionTitle,
  Skeleton,
  Tip,
} from "@/components/iw/ui";
import {
  dossierUrl,
  useIncident,
  useIncidents,
  useSetStatus,
  useThresholds,
} from "@/lib/client/api";
import type { UiListItem } from "@/lib/client/contract-ui";
import {
  fmtDateTime,
  fmtDayMonth,
  hostOf,
  MODULE_SHORT,
  plural,
  reviewText,
  STATUS_LABEL,
  shortName,
} from "@/lib/client/format";
import { entityName, materialTitle } from "@/lib/client/queue";

function Timeline({ items }: { items: UiListItem[] }) {
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return null;
  const start = new Date(first.created_at).getTime();
  const span = Math.max(1, new Date(last.created_at).getTime() - start);
  return (
    <Card className="p-4">
      <SectionTitle>Materiały w czasie</SectionTitle>
      <div className="relative mx-2 mt-6 mb-8 h-px bg-line-300">
        {sorted.map((item) => {
          const left = ((new Date(item.created_at).getTime() - start) / span) * 100;
          return (
            <Link
              key={item.id}
              href={`/kolejka/${item.id}`}
              className="absolute -top-2 -translate-x-1/2 rounded-full bg-surface-0"
              style={{ left: `${left}%` }}
            >
              <Tip label={`${fmtDateTime(item.created_at)} · ${STATUS_LABEL[item.status]}`}>
                <StatusGlyph status={item.status} />
              </Tip>
            </Link>
          );
        })}
        <span className="absolute top-3 left-0 text-ink-600 text-xs">
          {fmtDayMonth(first.created_at)}
        </span>
        <span className="absolute top-3 right-0 text-ink-600 text-xs">
          {fmtDayMonth(last.created_at)}
        </span>
      </div>
    </Card>
  );
}

function MaterialCard({ item }: { item: UiListItem }) {
  const thresholds = useThresholds();
  const setStatus = useSetStatus();
  const threshold = thresholds.data?.[item.module];
  return (
    <li className="group relative">
      {item.status === "confirmed" ? (
        <button
          type="button"
          disabled={setStatus.isPending}
          onClick={() =>
            setStatus.mutate(
              { id: item.id, status: "postponed", note: "dowód niepełny" },
              {
                onSuccess: () => toast.success("Odłożono: dowód niepełny"),
                onError: (error) => toast.error(error.message),
              },
            )
          }
          className="absolute top-3 right-3 z-10 h-8 rounded-md border border-ink-400 bg-surface-0 px-3 font-medium text-ink-900 text-xs opacity-0 transition-opacity duration-150 hover:bg-surface-hover focus-visible:opacity-100 group-hover:opacity-100"
        >
          Odłóż: dowód niepełny
        </button>
      ) : null}
      <Link
        href={`/kolejka/${item.id}`}
        className="flex flex-col gap-1.5 rounded-lg border border-line-200 p-4 hover:bg-surface-hover"
      >
        <span className="flex items-center gap-2">
          <StatusGlyph status={item.status} />
          <span className="truncate font-medium text-ink-900 text-sm">{materialTitle(item)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-3">
          <Chip>{MODULE_SHORT[item.module]}</Chip>
          <PlatformLabel platform={item.platform} className="text-[13px]" />
          {threshold ? (
            <ScoreCell
              score={item.risk_score ?? item.score}
              flag={threshold.flag}
              alert={threshold.alert}
            />
          ) : null}
        </span>
        <span className="truncate text-[13px] text-ink-600">
          oflagowano {fmtDateTime(item.created_at)} · {hostOf(item.url)}
        </span>
        <span className="flex items-center gap-2 text-[13px] text-ink-700">
          {item.reviewed_by ? <Avatar reviewer={item.reviewed_by} /> : null}
          {reviewText(item)}
          {item.review_note ? `: ${item.review_note}` : ""}
        </span>
      </Link>
    </li>
  );
}

function Registry({ id }: { id: string }) {
  const detail = useIncident(id);
  const entity = detail.data?.details.entity;
  if (!entity) return <Skeleton className="h-24 w-full" />;
  const facts = [
    entity.in_register === null
      ? "Rejestr KNF: nie sprawdzono"
      : entity.in_register
        ? `W rejestrze KNF${entity.knf_id ? ` (nr ${entity.knf_id})` : ""}`
        : "Brak w rejestrze KNF",
    entity.on_warning_list === null
      ? null
      : entity.on_warning_list
        ? "Lista ostrzeżeń publicznych KNF: jest wpis"
        : "Lista ostrzeżeń publicznych KNF: brak wpisu",
    entity.nip ? `NIP ${entity.nip}` : null,
    entity.domain ? `Domena ${entity.domain}` : null,
  ].filter(Boolean);
  return (
    <Card className="p-4">
      <SectionTitle>Rejestr KNF</SectionTitle>
      <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-700">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </Card>
  );
}

// Widok podmiotu (Z4): wszystkie materiały jednej firmy, niezależnie od statusu.
export function Entity() {
  const name = useSearchParams().get("nazwa") ?? "";
  const list = useIncidents({ page_size: 200 });
  const items = (list.data?.items ?? []).filter((item) => entityName(item) === name);
  const confirmed = items.filter((item) => item.status === "confirmed");
  const open = items.filter((item) => item.status === "new" || item.status === "in_review");
  const dismissed = items.filter((item) => item.status === "dismissed");
  const postponed = items.filter((item) => item.status === "postponed");
  const decisions = items
    .filter((item) => item.status !== "new" && item.reviewed_at)
    .sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""));
  const publishers = new Map<string, number>();
  for (const item of items) {
    const key = item.advertiser ?? hostOf(item.url);
    publishers.set(key, (publishers.get(key) ?? 0) + 1);
  }
  const firstId = items[0]?.id;
  const firstEntity = useIncident(firstId ?? "", Boolean(firstId));

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
      <nav aria-label="Ścieżka" className="flex items-center gap-2 text-[13px] text-ink-600">
        <Link href="/kolejka" className="hover:text-ink-900 hover:underline">
          Kolejka
        </Link>
        <ChevronRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        <span>{name || "Podmiot"}</span>
      </nav>
      <PageHeader
        actions={
          confirmed.length ? (
            <a
              href={dossierUrl(name)}
              download
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary-700 px-3.5 font-medium text-sm text-white transition-colors duration-150 hover:bg-primary-800 active:bg-primary-900"
            >
              <Download className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Eksportuj teczkę ({confirmed.length})
            </a>
          ) : undefined
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {name || "Podmiot"}
            {firstId && firstEntity.data ? (
              <RegistryChip entity={firstEntity.data.details.entity} />
            ) : null}
          </span>
        }
        description={
          list.data
            ? `Teczka: ${confirmed.length} ${plural(confirmed.length, "potwierdzony materiał", "potwierdzone materiały", "potwierdzonych materiałów")} · ${open.length} ${plural(open.length, "otwarty", "otwarte", "otwartych")} · ${postponed.length} ${plural(postponed.length, "odłożony", "odłożone", "odłożonych")} · ${dismissed.length} ${plural(dismissed.length, "fałszywy alarm", "fałszywe alarmy", "fałszywych alarmów")}`
            : undefined
        }
      />
      {list.error ? <ErrorNote error={list.error} /> : null}
      {!list.data ? (
        <Skeleton className="h-60 w-full" />
      ) : items.length === 0 ? (
        <EmptyState illustration="archiwum" title="Brak materiałów tego podmiotu">
          Lista obejmuje 200 najnowszych incydentów.
        </EmptyState>
      ) : (
        <>
          <Timeline items={items} />
          <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
            <div className="flex flex-col gap-4">
              {[
                { title: "Potwierdzone materiały", list: confirmed },
                { title: "Otwarte", list: open },
                { title: "Odłożone", list: postponed },
                { title: "Fałszywe alarmy", list: dismissed },
              ]
                .filter((section) => section.list.length)
                .map((section) => (
                  <section key={section.title} className="flex flex-col gap-2">
                    <SectionTitle>
                      {section.title} ({section.list.length})
                    </SectionTitle>
                    <ul className="flex flex-col gap-2">
                      {section.list.map((item) => (
                        <MaterialCard key={item.id} item={item} />
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
            <div className="flex flex-col gap-4">
              <Card className="p-4">
                <SectionTitle>Publikujący o tym podmiocie</SectionTitle>
                <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-700">
                  {[...publishers.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([publisher, count]) => (
                      <li key={publisher}>
                        {publisher} · {count} {plural(count, "materiał", "materiały", "materiałów")}
                      </li>
                    ))}
                </ul>
              </Card>
              {firstId ? <Registry id={firstId} /> : null}
              {decisions.length ? (
                <Card className="p-4">
                  <SectionTitle>Historia decyzji</SectionTitle>
                  <ul className="mt-2 flex flex-col gap-2 text-[13px] text-ink-700">
                    {decisions.map((item) => (
                      <li key={item.id} className="flex items-start gap-2">
                        {item.reviewed_by ? <Avatar reviewer={item.reviewed_by} /> : null}
                        <span>
                          <span className="tnum">
                            {fmtDateTime(item.reviewed_at ?? item.created_at)}
                          </span>
                          {item.reviewed_by ? ` · ${shortName(item.reviewed_by)}` : ""} ·{" "}
                          {STATUS_LABEL[item.status]}
                          {item.review_note ? `: ${item.review_note}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
