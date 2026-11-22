"use client";

import type { AnalysisModule } from "@app/db";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Illustration } from "@/components/iw/icons";
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  PageHeader,
  SectionTitle,
  Skeleton,
  StatusTip,
  Tabs,
  Tip,
} from "@/components/iw/ui";
import type { ModuleThreshold } from "@/lib/analysis/modules";
import { useCalibration, useIncidents, useSaveThreshold, useThresholds } from "@/lib/client/api";
import {
  fmtDateTime,
  fmtScore,
  fmtSigned,
  MODULE_NAME,
  plural,
  reviewText,
  STATUS_LABEL,
} from "@/lib/client/format";
import { materialTitle } from "@/lib/client/queue";
import type { Calibration as CalibrationData } from "@/lib/incidents/contract";
import { cn } from "@/lib/utils";

const MIN_LABELED = 10;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Różnica kolorowana po znaku: plus zielony, minus pomarańczowy (decyzja z 22.11, wariant A).
function Delta({ value, digits = 0 }: { value: number; digits?: number }) {
  if (Math.abs(value) < 10 ** -(digits + 1)) {
    return null;
  }
  return (
    <Chip
      className={cn(
        "tnum",
        value > 0 ? "bg-success-50 text-success-700" : "bg-risk-50 text-risk-700",
      )}
    >
      {fmtSigned(value, digits)}
    </Chip>
  );
}

function Metric({
  title,
  hint,
  before,
  after,
  digits,
}: {
  title: string;
  hint?: string;
  before: number | null | undefined;
  after: number | null | undefined;
  digits: number;
}) {
  const fmt = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : digits
        ? value.toFixed(digits).replace(".", ",")
        : String(value);
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <p className="flex items-center gap-1.5 text-[13px] text-ink-700">
        {title}
        {hint ? (
          <Tip label={hint}>
            <Info className="size-3.5 text-ink-400" strokeWidth={1.5} aria-label={hint} />
          </Tip>
        ) : null}
      </p>
      <p className="flex items-baseline gap-2">
        <span className="tnum text-[15px] text-ink-600">{fmt(before)}</span>
        <span className="text-ink-400" aria-hidden="true">
          →
        </span>
        <span className="tnum font-semibold text-[28px] text-ink-900 leading-8">{fmt(after)}</span>
      </p>
      <span>
        {before !== null && before !== undefined && after !== null && after !== undefined ? (
          <Delta value={after - before} digits={digits} />
        ) : (
          <Chip>nie do policzenia</Chip>
        )}
      </span>
    </Card>
  );
}

// Etykiety pod suwakiem: przy krawędzi wyrównane do brzegu zamiast centrowane, końce skali
// („0,00”, „1,00”) chowamy, gdy etykieta progu stoi tuż przy nich, a bliskie progi idą w dwa rzędy.
const EDGE_HIDE = 0.15;
const EDGE_ALIGN = 0.08;
const LABELS_APART = 0.25;

function anchor(x: number): string {
  if (x < EDGE_ALIGN) return "";
  if (x > 1 - EDGE_ALIGN) return "-translate-x-full";
  return "-translate-x-1/2";
}

function Slider({
  value,
  saved,
  alert,
  onChange,
}: {
  value: number;
  saved: number;
  alert: number;
  onChange: (value: number) => void;
}) {
  const same = Math.abs(saved - alert) < 0.005;
  const stacked = !same && Math.abs(alert - saved) < LABELS_APART;
  return (
    <div className="relative pt-7 pb-6">
      <span
        className="tnum absolute top-0 -translate-x-1/2 font-semibold text-ink-900 text-sm"
        style={{ left: `${value * 100}%` }}
      >
        {fmtScore(value)}
      </span>
      <div className="relative h-1 rounded-full bg-line-200">
        <span
          className="absolute -top-1.5 h-4 w-px bg-ink-900"
          style={{ left: `${saved * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute -top-1.5 h-4 w-px bg-ink-900"
          style={{ left: `${alert * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute -top-px h-1.5 bg-ink-900"
          style={{
            left: `${Math.min(saved, value) * 100}%`,
            width: `${Math.abs(value - saved) * 100}%`,
          }}
          aria-hidden="true"
        />
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label="Próg flagi"
        aria-valuetext={fmtScore(value)}
        // Skala 0–1 jak na podziałce; próg flagi nie może przekroczyć progu alertu (kontrakt §8).
        onChange={(event) =>
          onChange(Math.min(alert, Math.max(0.01, round(Number(event.target.value)))))
        }
        className="absolute inset-x-0 top-[22px] h-5 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink-900 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink-900 [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125 focus-visible:[&::-webkit-slider-thumb]:outline-2 focus-visible:[&::-webkit-slider-thumb]:outline-primary-700 focus-visible:[&::-webkit-slider-thumb]:outline-offset-2"
      />
      <div
        className={cn(
          "relative mt-3 whitespace-nowrap text-ink-600 text-xs",
          stacked ? "h-8" : "h-4",
        )}
      >
        {[saved, alert].some((x) => x < EDGE_HIDE) ? null : (
          <span className="absolute left-0">0,00</span>
        )}
        {[saved, alert].some((x) => x > 1 - EDGE_HIDE) ? null : (
          <span className="absolute right-0">1,00</span>
        )}
        {same ? (
          <span className={cn("absolute", anchor(saved))} style={{ left: `${saved * 100}%` }}>
            zapisany i próg alertu {fmtScore(saved)}
          </span>
        ) : (
          <>
            <span className={cn("absolute", anchor(alert))} style={{ left: `${alert * 100}%` }}>
              próg alertu {fmtScore(alert)}
            </span>
            <span
              className={cn("absolute", anchor(saved), stacked && "top-4")}
              style={{ left: `${saved * 100}%` }}
            >
              zapisany {fmtScore(saved)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Matrix({ data, ads }: { data: CalibrationData | undefined; ads: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 font-semibold text-[15px] text-ink-900"
      >
        {open ? (
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden="true" />
        )}
        Macierz pomyłek
      </button>
      {open && data ? (
        <table className="tnum mt-3 w-full text-[13px]">
          <thead>
            <tr className="text-ink-600">
              <th className="py-1 text-left font-normal" />
              <th className="py-1 text-right font-normal">{ads ? "Reklama" : "Potwierdzony"}</th>
              <th className="py-1 text-right font-normal">
                {ads ? "Nie reklama" : "Fałszywy alarm"}
              </th>
            </tr>
          </thead>
          <tbody className="text-ink-900">
            <tr>
              <th className="py-1 text-left font-normal text-ink-600">≥ progu</th>
              <td className="py-1 text-right">TP {data.tp}</td>
              <td className="py-1 text-right">FP {data.fp}</td>
            </tr>
            <tr>
              <th className="py-1 text-left font-normal text-ink-600">&lt; progu</th>
              <td className="py-1 text-right">FN {data.fn}</td>
              <td className="py-1 text-right">TN {data.tn}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="mt-1 text-[13px] text-ink-600">
          Rozwiń, żeby zobaczyć, skąd biorą się FP i FN.
        </p>
      )}
    </Card>
  );
}

function DropList({
  module,
  saved,
  candidate,
}: {
  module: AnalysisModule;
  saved: number;
  candidate: number;
}) {
  const list = useIncidents({ module: [module], page_size: 200 });
  const items = (list.data?.items ?? [])
    .filter((item) => item.score < candidate)
    .sort((a, b) => a.score - b.score);
  if (candidate <= saved) {
    return (
      <Card className="p-4">
        <SectionTitle>Materiały przy progu {fmtScore(candidate)}</SectionTitle>
        <p className="mt-2 text-[13px] text-ink-600">
          {candidate < saved
            ? `Niższy próg dokłada do Naruszeń materiały z wynikiem od ${fmtScore(candidate)} do ${fmtScore(saved)}. Nikt ich jeszcze nie oceniał, więc nie zmieniają FP ani FN.`
            : "Przesuń suwak, żeby zobaczyć, które materiały wypadną z Naruszeń."}
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <SectionTitle>
        Materiały, które wypadają przy {fmtScore(candidate)} ({items.length})
      </SectionTitle>
      {list.error ? <ErrorNote error={list.error} /> : null}
      <ul className="mt-2 divide-y divide-line-200">
        {items.map((item) => {
          const impact =
            item.status === "dismissed"
              ? "ubywa FP"
              : item.status === "confirmed"
                ? "przybywa FN"
                : "bez wpływu";
          return (
            <li key={item.id}>
              <Link
                href={`/kolejka/${item.id}`}
                className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-surface-hover"
              >
                <StatusTip review={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900 text-sm">
                    {materialTitle(item)}
                  </span>
                  <span className="block text-[13px] text-ink-600">
                    {item.status === "new" || item.status === "in_review"
                      ? `${STATUS_LABEL[item.status]}, bez decyzji · zostaje w Naruszeniach`
                      : reviewText(item)}
                    {" · "}oflagowano {fmtDateTime(item.created_at)}
                  </span>
                </span>
                <Chip>{impact}</Chip>
                <span className="tnum w-10 text-right font-semibold text-ink-900 text-sm">
                  {fmtScore(item.score)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {list.data && items.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-600">Przy tym progu nic nie wypada.</p>
      ) : null}
    </Card>
  );
}

function ModuleCalibration({
  module,
  threshold,
}: {
  module: AnalysisModule;
  threshold: ModuleThreshold;
}) {
  const [candidate, setCandidate] = useState(threshold.flag);
  useEffect(() => setCandidate(threshold.flag), [threshold.flag]);
  const before = useCalibration(module, threshold.flag);
  const after = useCalibration(module, candidate);
  const save = useSaveThreshold();
  const n = MODULE_NAME[module].toLowerCase();
  const ads = module === "finfluencer";
  const changed = candidate !== threshold.flag;
  const flaggedBefore = before.data?.flagged;
  const flaggedAfter = after.data?.flagged;
  const labeled = after.data?.labeled;
  const diff =
    flaggedBefore !== undefined && flaggedAfter !== undefined ? flaggedBefore - flaggedAfter : null;

  let headline = `Przy progu ${fmtScore(candidate)} w obszarze „${n}” jest ${flaggedAfter ?? "…"} oflagowanych materiałów.`;
  if (changed && diff !== null && diff > 0) {
    headline = `Przy progu ${fmtScore(candidate)} z oflagowanych w module ${n} wypada ${diff} z ${flaggedBefore} materiałów.`;
  } else if (changed && diff !== null && diff < 0) {
    headline = `Przy progu ${fmtScore(candidate)} w obszarze „${n}” dochodzi ${-diff} materiałów.`;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="px-5 pt-5 pb-3">
        <p className="font-semibold text-ink-900 text-lg">{headline}</p>
        <p className="mt-1 text-[13px] text-ink-600">
          Liczone na {labeled ?? "…"} decyzjach analityków (
          {ads ? "To reklama i To nie reklama" : "Potwierdzony i Fałszywy alarm"}).
        </p>
        <Slider
          value={candidate}
          saved={threshold.flag}
          alert={threshold.alert}
          onChange={setCandidate}
        />
      </Card>

      {labeled !== undefined && labeled < MIN_LABELED ? (
        <Card className="flex items-center gap-4 p-4">
          <Illustration name="kontrole" size={40} />
          <p className="text-[13px] text-ink-700">
            Za mało decyzji, żeby ufać liczbom: {labeled} z co najmniej {MIN_LABELED}. Przejrzyj
            więcej materiałów w Naruszeniach, zanim zmienisz próg.
          </p>
        </Card>
      ) : null}

      {before.error ? <ErrorNote error={before.error} /> : null}
      <div className="grid grid-cols-4 gap-4">
        <Metric
          title={ads ? "Nie-reklamy w rejestrze (FP)" : "Fałszywe alarmy (FP)"}
          before={before.data?.fp}
          after={after.data?.fp}
          digits={0}
        />
        <Metric
          title={ads ? "Przeoczone reklamy (FN)" : "Przeoczone naruszenia (FN)"}
          before={before.data?.fn}
          after={after.data?.fn}
          digits={0}
        />
        <Metric
          title="Precyzja"
          hint={
            ads
              ? "Jaka część wykrytych materiałów to potwierdzone reklamy."
              : "Jaka część oflagowanych materiałów to potwierdzone naruszenia."
          }
          before={before.data?.precision}
          after={after.data?.precision}
          digits={2}
        />
        <Metric
          title="Pełność"
          hint={
            ads
              ? "Jaką część potwierdzonych reklam próg wyłapuje."
              : "Jaką część potwierdzonych naruszeń próg wyłapuje."
          }
          before={before.data?.recall}
          after={after.data?.recall}
          digits={2}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!changed || save.isPending}
          onClick={() =>
            save.mutate(
              { [module]: { flag: candidate, alert: threshold.alert } },
              {
                onSuccess: () => toast.success(`Zapisano próg ${fmtScore(candidate)}: ${n}`),
                onError: (error) => toast.error(error.message),
              },
            )
          }
        >
          Zapisz próg {fmtScore(candidate)}
        </Button>
        <Button disabled={!changed} onClick={() => setCandidate(threshold.flag)}>
          Przywróć {fmtScore(threshold.flag)}
        </Button>
        <p className="text-[13px] text-ink-600">
          {changed && diff !== null && diff > 0
            ? `Zapis od razu zmienia Naruszenia: ${diff} ${plural(diff, "materiał zniknie", "materiały znikną", "materiałów zniknie")} z listy.`
            : "Zapis od razu zmienia Naruszenia i wykres na Przeglądzie."}
        </p>
      </div>

      <div className="grid grid-cols-[360px_minmax(0,1fr)] items-start gap-4">
        <Matrix data={after.data} ads={ads} />
        <DropList module={module} saved={threshold.flag} candidate={candidate} />
      </div>
    </div>
  );
}

export function Calibration() {
  const [module, setModule] = useState<AnalysisModule>("finfluencer");
  const thresholds = useThresholds();
  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-5">
      <PageHeader
        title="Kalibracja"
        description="Próg flagi decyduje, co trafia do Naruszeń i do rejestru reklam. FP i FN liczymy z decyzji analityków."
        actions={
          <Tabs
            label="Obszar"
            value={module}
            onChange={setModule}
            tabs={[
              { value: "finfluencer", label: MODULE_NAME.finfluencer },
              { value: "risk_disclosure", label: MODULE_NAME.risk_disclosure },
              { value: "unauthorized_advisory", label: MODULE_NAME.unauthorized_advisory },
            ]}
          />
        }
      />
      {thresholds.error ? <ErrorNote error={thresholds.error} /> : null}
      {thresholds.data ? (
        <ModuleCalibration key={module} module={module} threshold={thresholds.data[module]} />
      ) : (
        <Skeleton className="h-[400px] w-full" />
      )}
    </div>
  );
}
