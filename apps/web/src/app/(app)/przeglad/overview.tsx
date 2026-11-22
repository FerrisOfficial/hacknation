"use client";

import type { AnalysisModule } from "@app/db";
import { ArrowRight, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Illustration, type IllustrationName, StatusGlyph } from "@/components/iw/icons";
import {
  Button,
  ButtonLink,
  Card,
  ErrorNote,
  PageHeader,
  SectionTitle,
  Skeleton,
  Tabs,
} from "@/components/iw/ui";
import { ANALYSIS_MODULES, type ModuleThreshold } from "@/lib/analysis/modules";
import {
  type SourceItem,
  sourceHasError,
  useIncidents,
  useRunSource,
  useSources,
  useThresholds,
  useTrend,
} from "@/lib/client/api";
import type { UiStatus } from "@/lib/client/contract-ui";
import {
  daysAgoIso,
  fmtScore,
  fmtTime,
  fmtToday,
  MODULE_NUMBER,
  MODULE_TITLE,
  plural,
  STATUS_LABEL,
} from "@/lib/client/format";
import { useHotkeys } from "@/lib/client/hotkeys";
import { cn } from "@/lib/utils";
import { TrendChart } from "./trend-chart";

const ILLUSTRATION: Record<AnalysisModule, IllustrationName> = {
  finfluencer: "megafon",
  risk_disclosure: "prawo",
  unauthorized_advisory: "konsultacje-prawne",
};

// Baner błędu źródła: kolor tylko w ikonie, panel szary (decyzja z 22.11, wariant A).
function SourceErrorBanner({ failed, total }: { failed: SourceItem[]; total: number }) {
  const run = useRunSource();
  const first = failed[0];
  if (!first) return null;
  const since = first.lastJob?.finishedAt ?? first.lastJob?.createdAt;
  const working = total - failed.length;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-line-300 bg-surface-1 px-4 py-3.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-100">
        <TriangleAlert className="size-4 text-warning-800" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink-900 text-sm">
          {first.name} nie pobiera się{since ? ` od ${fmtTime(since)}` : ""}
          {failed.length > 1 ? ` (i ${failed.length - 1} innych)` : ""}
        </p>
        <p className="text-[13px] text-ink-600">
          Materiały z {failed.length > 1 ? "tych źródeł" : "tego źródła"} nie trafiają do Kolejki.
          {working > 0
            ? ` Pozostałe ${working} ${plural(working, "źródło działa", "źródła działają", "źródeł działa")}.`
            : ""}
          {first.lastJob?.error ? ` Błąd: ${first.lastJob.error}` : ""}
        </p>
      </div>
      <Button
        icon={<RefreshCw className="size-4" strokeWidth={1.5} aria-hidden="true" />}
        disabled={run.isPending}
        onClick={() =>
          run.mutate(first.id, {
            onSuccess: () => toast.success(`Ponowiono pobieranie: ${first.name}`),
            onError: (error) => toast.error(error.message),
          })
        }
      >
        Ponów
      </Button>
      <ButtonLink href="/zrodla">Zobacz Źródła</ButtonLink>
    </div>
  );
}

function ModuleCard({
  module,
  threshold,
}: {
  module: AnalysisModule;
  threshold: ModuleThreshold | undefined;
}) {
  const fresh = useIncidents({ module: [module], status: ["new"], page_size: 1 });
  const high = useIncidents(
    { module: [module], status: ["new"], min_score: threshold?.alert, page_size: 1 },
    threshold !== undefined,
  );
  const highCount = high.data?.total;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex gap-3">
        <Illustration name={ILLUSTRATION[module]} size={32} />
        <div>
          <SectionTitle>Moduł {MODULE_NUMBER[module]}</SectionTitle>
          <p className="mt-0.5 text-[13px] text-ink-600">{MODULE_TITLE[module]}</p>
        </div>
      </div>
      <div className="flex gap-8">
        <div>
          {fresh.data ? (
            <p className="tnum font-semibold text-[28px] text-ink-900 leading-8">
              {fresh.data.total}
            </p>
          ) : (
            <Skeleton className="h-8 w-10" />
          )}
          <p className="text-[13px] text-ink-600">nowych</p>
        </div>
        <div>
          {highCount !== undefined ? (
            <p
              className={cn(
                "tnum font-semibold text-[28px] leading-8",
                highCount > 0 ? "text-risk-700" : "text-ink-500",
              )}
            >
              {highCount}
            </p>
          ) : (
            <Skeleton className="h-8 w-10" />
          )}
          <p className="text-[13px] text-ink-600">
            wysokie{threshold ? `, ≥ ${fmtScore(threshold.alert)}` : ""}
          </p>
        </div>
      </div>
      <Link
        href={`/kolejka?modul=${MODULE_NUMBER[module]}`}
        className="mt-auto inline-flex items-center gap-1 font-medium text-[13px] text-primary-700 hover:underline"
      >
        Pokaż w Kolejce
        <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      </Link>
    </Card>
  );
}

const STATUS_VIEW: Record<UiStatus, string> = {
  new: "otwarte",
  in_review: "otwarte",
  postponed: "odlozone",
  confirmed: "potwierdzone",
  dismissed: "falszywe",
};

function StatusLink({ status, from }: { status: UiStatus; from: string }) {
  const query = useIncidents({ status: [status], from, page_size: 1 });
  return (
    <Link
      href={`/kolejka?widok=${STATUS_VIEW[status]}&data=7`}
      className="inline-flex items-center gap-1.5 text-[13px] text-ink-700 underline decoration-line-300 underline-offset-4 hover:text-ink-900 hover:decoration-ink-900"
    >
      <StatusGlyph status={status} />
      {STATUS_LABEL[status]}
      <span className="tnum">{query.data?.total ?? "…"}</span>
    </Link>
  );
}

export function Overview() {
  const router = useRouter();
  const [range, setRange] = useState<"7" | "30">("7");
  const thresholds = useThresholds();
  const sources = useSources();
  const open = useIncidents({ status: ["new"], page_size: 1 });
  const weekFrom = daysAgoIso(6);
  const trend = useTrend(daysAgoIso(range === "7" ? 6 : 29));

  useHotkeys({ Enter: () => router.push("/kolejka") });

  const items = sources.data?.items ?? [];
  const failed = items.filter(sourceHasError);
  const last = items
    .map((source) => source.lastScrapedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-5">
      <PageHeader
        title="Przegląd"
        description={`${fmtToday()}${last ? ` · ostatnie pobranie ${fmtTime(last)}` : ""}`}
        actions={
          <ButtonLink href="/kolejka" variant="primary" shortcut="Enter">
            Otwórz Kolejkę
            {open.data
              ? ` · ${open.data.total} ${plural(open.data.total, "nowy", "nowe", "nowych")}`
              : ""}
          </ButtonLink>
        }
      />

      <SourceErrorBanner failed={failed} total={items.length} />

      <div className="grid grid-cols-3 gap-4">
        {ANALYSIS_MODULES.map((module) => (
          <ModuleCard key={module} module={module} threshold={thresholds.data?.[module]} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-[13px] text-ink-600">Ostatnie 7 dni:</span>
        {(["new", "in_review", "postponed", "confirmed", "dismissed"] as const).map((status) => (
          <StatusLink key={status} status={status} from={weekFrom} />
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between border-line-200 border-b">
          <SectionTitle className="pb-3">Oflagowane materiały w czasie</SectionTitle>
          <Tabs
            label="Zakres wykresu"
            value={range}
            onChange={setRange}
            tabs={[
              { value: "7", label: "7 dni" },
              { value: "30", label: "30 dni" },
            ]}
          />
        </div>
        <div className="pt-5">
          {trend.error ? <ErrorNote error={trend.error} /> : null}
          {trend.data ? (
            <TrendChart points={trend.data.points} />
          ) : (
            <Skeleton className="h-[260px] w-full" />
          )}
        </div>
      </Card>
    </div>
  );
}
