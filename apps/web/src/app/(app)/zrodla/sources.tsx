"use client";

import { Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PlatformLabel } from "@/components/iw/icons";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  PageHeader,
  Skeleton,
  Tip,
} from "@/components/iw/ui";
import {
  type SourceItem,
  sourceHasError,
  useRunSource,
  useSources,
  useUpdateSource,
} from "@/lib/client/api";
import { fmtRelative, hostOf, plural } from "@/lib/client/format";
import { cn } from "@/lib/utils";
import { AddSource, INTERVAL_OPTIONS } from "./add-source";

// Harmonogram źródła do zmiany w miejscu (PATCH /api/sources/:id, intervalMinutes).
function IntervalSelect({ source }: { source: SourceItem }) {
  const update = useUpdateSource();
  const current = source.intervalMinutes === null ? "manual" : String(source.intervalMinutes);
  const known = INTERVAL_OPTIONS.some((option) => option.value === current);
  return (
    <select
      aria-label={`Jak często skanować: ${source.name}`}
      value={current}
      disabled={update.isPending}
      onChange={(event) => {
        const value = event.target.value;
        update.mutate(
          { id: source.id, intervalMinutes: value === "manual" ? null : Number(value) },
          {
            onSuccess: () => toast.success(`Zmieniono harmonogram: ${source.name}`),
            onError: (error) => toast.error(error.message),
          },
        );
      }}
      className="h-8 rounded-md border border-line-300 bg-surface-0 px-2 text-ink-900 text-sm hover:border-ink-400"
    >
      {known ? null : <option value={current}>{interval(source.intervalMinutes)}</option>}
      {INTERVAL_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function interval(minutes: number | null): string {
  if (minutes === null) return "ręcznie";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  return `${Math.round(minutes / 60)} h`;
}

function describe(source: SourceItem): string {
  switch (source.config.kind) {
    case "youtube_search":
      return `fraza „${source.config.query}”`;
    case "youtube_channel":
      return `kanał ${hostOf(source.config.channelUrl)}`;
    default:
      return hostOf(source.url);
  }
}

function State({ source }: { source: SourceItem }) {
  const job = source.lastJob;
  if (!source.active) return <span className="text-ink-600">Wyłączone</span>;
  if (sourceHasError(source) && job) {
    return (
      <span className="flex min-w-0 items-start gap-1.5 font-medium text-ink-900">
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-warning-800"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="min-w-0">
          Błąd od {fmtRelative(job.finishedAt ?? job.createdAt)}
          {job.error ? (
            <span className="block truncate font-normal text-ink-600">{job.error}</span>
          ) : null}
        </span>
      </span>
    );
  }
  if (job?.status === "running" || job?.status === "queued") {
    return <span className="text-ink-700">Pobiera teraz…</span>;
  }
  return (
    <span className="text-ink-700">
      Działa
      {source.lastScrapedAt
        ? ` · pobrano ${fmtRelative(source.lastScrapedAt)}`
        : " · jeszcze nie pobrano"}
    </span>
  );
}

// Źródła (Z1, R9): stan pobierania i Ponów. Konfiguracja techniczna jest poza produktem.
export function Sources() {
  const sources = useSources();
  const run = useRunSource();
  const [adding, setAdding] = useState(false);
  const items = sources.data?.items ?? [];
  const failed = items.filter(sourceHasError).length;
  const active = items.filter((source) => source.active).length;

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
      <PageHeader
        title="Źródła"
        description="System pobiera źródła według harmonogramu. Tu dodasz źródło, zmienisz, jak często je skanować, i ponowisz pobranie."
        actions={
          adding ? undefined : (
            <Button
              variant="primary"
              icon={<Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />}
              onClick={() => setAdding(true)}
            >
              Dodaj źródło
            </Button>
          )
        }
      />
      <AddSource open={adding} setOpen={setAdding} />
      {sources.data ? (
        <div className="flex gap-2">
          <Chip>
            {items.length} {plural(items.length, "źródło", "źródła", "źródeł")}
          </Chip>
          <Chip>{active - failed} działa</Chip>
          {failed ? (
            <Chip className="bg-warning-100 text-warning-800">
              {failed} {plural(failed, "błąd", "błędy", "błędów")}
            </Chip>
          ) : null}
        </div>
      ) : null}
      {sources.error ? <ErrorNote error={sources.error} /> : null}
      {!sources.data ? (
        <Skeleton className="h-60 w-full" />
      ) : items.length === 0 ? (
        <EmptyState illustration="systemy-inf" title="Brak źródeł">
          Dodaj pierwsze źródło przyciskiem „Dodaj źródło”.
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-1 text-left font-medium text-ink-600 text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Źródło</th>
                <th className="px-4 py-2.5 font-medium">Platforma</th>
                <th className="px-4 py-2.5 text-right font-medium">Materiały</th>
                <th className="px-4 py-2.5 text-right font-medium">Co ile</th>
                <th className="px-4 py-2.5 font-medium">Stan</th>
                <th className="w-28 px-4 py-2.5">
                  <span className="sr-only">Akcje</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-200">
              {items.map((source) => {
                const error = sourceHasError(source);
                return (
                  <tr
                    key={source.id}
                    className={cn("group hover:bg-surface-hover", error && "bg-surface-1")}
                  >
                    <td className="max-w-[360px] px-4 py-3">
                      <span className="block truncate font-medium text-ink-900">{source.name}</span>
                      <span className="block truncate text-[13px] text-ink-600">
                        {describe(source)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PlatformLabel platform={source.platform} className="text-[13px]" />
                    </td>
                    <td className="tnum px-4 py-3 text-right text-ink-900">
                      {source.materialsCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <IntervalSelect source={source} />
                    </td>
                    <td className="max-w-[320px] px-4 py-3 text-[13px]">
                      <Tip
                        label={
                          source.lastJob
                            ? `Ostatnie zadanie: ${source.lastJob.status}, ${fmtRelative(source.lastJob.createdAt)}${source.nextRunAt ? ` · następne ${fmtRelative(source.nextRunAt)}` : ""}`
                            : "Jeszcze nie pobierano"
                        }
                      >
                        <State source={source} />
                      </Tip>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        icon={<RefreshCw className="size-4" strokeWidth={1.5} aria-hidden="true" />}
                        className={cn(
                          !error &&
                            "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                        )}
                        disabled={run.isPending || !source.active}
                        onClick={() =>
                          run.mutate(source.id, {
                            onSuccess: () => toast.success(`Ponowiono pobieranie: ${source.name}`),
                            onError: (failure) => toast.error(failure.message),
                          })
                        }
                      >
                        {run.isPending && run.variables === source.id ? "Ponawiam…" : "Ponów"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {failed === 0 && items.length > 0 ? (
        <p className="text-[13px] text-ink-600">
          Wszystkie źródła działają. Ponów pojawia się po najechaniu na wiersz.
        </p>
      ) : null}
    </div>
  );
}
