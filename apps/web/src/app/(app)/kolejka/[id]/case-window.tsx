"use client";

import type { ReviewStatus } from "@app/db";
import {
  ArrowRight,
  Braces,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Fingerprint,
  Gauge,
  History,
  RadioTower,
  Scale,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlatformLabel, StatusGlyph } from "@/components/iw/icons";
import { showDecisionToast } from "@/components/iw/toasts";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  OutlineChip,
  SectionTitle,
  Skeleton,
  Tabs,
  Tip,
} from "@/components/iw/ui";
import type { ModuleThreshold } from "@/lib/analysis/modules";
import { withBasePath } from "@/lib/base-path";
import { useIncident, useIncidents, useSetStatus, useThresholds } from "@/lib/client/api";
import {
  fmtDateTime,
  fmtDayHeader,
  fmtScore,
  fmtTime,
  hostOf,
  labelText,
  MODULE_SHORT,
  plural,
  STATUS_LABEL,
} from "@/lib/client/format";
import { useHotkeys } from "@/lib/client/hotkeys";
import {
  buildQueue,
  entityName,
  queueFilters,
  queueSearch,
  readQueueParams,
} from "@/lib/client/queue";
import type { Flag, IncidentDetail, IncidentEntity } from "@/lib/incidents/contract";
import { cn } from "@/lib/utils";

// Ostatnia decyzja w tej karcie przeglądarki. Poza komponentem, bo po decyzji Okno sprawy
// przechodzi do następnego materiału, a Ctrl+Z i „Cofnij” w toaście mają nadal działać (R5).
let lastDecision: { id: string; previous: ReviewStatus } | null = null;

const DECISION_TEXT: Partial<Record<ReviewStatus, string>> = {
  confirmed: "Potwierdzono naruszenie",
  dismissed: "Oznaczono jako fałszywy alarm",
};

function detailTitle(detail: IncidentDetail): string {
  return (
    detail.material.title ??
    detail.details.entity.advertiser ??
    detail.material.author ??
    hostOf(detail.material.url)
  );
}

function fmtSeconds(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ─── Treść z podkreślonymi fragmentami (R3) ─────────────────────────────────────────────────

type Segment = { text: string; rule?: string };

function segments(text: string, flags: Flag[]): Segment[] {
  const ranges = flags
    .filter((flag) => flag.result === "violation" && flag.evidence)
    .map((flag) => ({
      start: flag.evidence?.start ?? 0,
      end: flag.evidence?.end ?? 0,
      rule: flag.rule_id,
    }))
    .filter((range) => range.end > range.start && range.end <= text.length)
    .sort((a, b) => a.start - b.start);
  const result: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    if (range.start > cursor) result.push({ text: text.slice(cursor, range.start) });
    result.push({ text: text.slice(range.start, range.end), rule: range.rule });
    cursor = range.end;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) });
  return result;
}

function MaterialText({
  text,
  flags,
  active,
  onActive,
}: {
  text: string;
  flags: Flag[];
  active: string | null;
  onActive: (rule: string | null) => void;
}) {
  if (!text.trim()) {
    return <p className="text-[13px] text-ink-600">Materiał nie ma zapisanej treści tekstowej.</p>;
  }
  return (
    <p className="max-h-[420px] overflow-y-auto whitespace-pre-wrap text-ink-700 text-sm leading-[22px]">
      {segments(text, flags).map((segment, index) =>
        segment.rule ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: segmenty są stałe dla danego tekstu
            key={index}
            onMouseEnter={() => onActive(segment.rule ?? null)}
            onMouseLeave={() => onActive(null)}
            className={cn(
              "rounded-sm bg-transparent font-semibold text-risk-700 underline decoration-[1.5px] underline-offset-2 transition-colors duration-150",
              active === segment.rule && "bg-risk-50",
            )}
          >
            {segment.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segmenty są stałe dla danego tekstu
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

// ─── Lewa kolumna: kopia materiału (Z3, R4) ─────────────────────────────────────────────────

type Layer = "wideo" | "html" | "dane";

function CopyPanel({ detail }: { detail: IncidentDetail }) {
  const isVideo = detail.material.platform === "youtube";
  const [layer, setLayer] = useState<Layer>(
    isVideo ? "wideo" : detail.material.has_snapshot ? "html" : "dane",
  );
  const timestamps = detail.details.flags
    .map((flag) => flag.evidence)
    .filter((evidence) => evidence?.timestamp_s !== null && evidence?.timestamp_s !== undefined);

  const tabs: { value: Layer; label: string; icon: ReactNode; disabled?: string }[] = [];
  if (isVideo) {
    tabs.push({
      value: "wideo",
      label: "Wideo",
      icon: <Video className="size-4" strokeWidth={1.5} aria-hidden="true" />,
    });
  }
  tabs.push(
    {
      value: "html",
      label: isVideo ? "Strona filmu (HTML)" : "Strona (HTML)",
      icon: <Code className="size-4" strokeWidth={1.5} aria-hidden="true" />,
      disabled: detail.material.has_snapshot ? undefined : "Brak kopii HTML z dnia pobrania",
    },
    {
      value: "dane",
      label: "Dane",
      icon: <Braces className="size-4" strokeWidth={1.5} aria-hidden="true" />,
    },
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-end justify-between border-line-200 border-b bg-surface-1 px-2">
        <Tabs label="Warstwa kopii" value={layer} onChange={setLayer} tabs={tabs} />
        <span className="pr-2 pb-2 text-[13px] text-ink-600">
          kopia {fmtDateTime(detail.material.scraped_at)}
        </span>
      </div>
      <div className="p-3">
        {layer === "wideo" ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-md bg-surface-1 px-6 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full border border-line-300 bg-surface-0">
              <Video className="size-4 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <p className="max-w-md text-[13px] text-ink-600">
              Film nie jest osadzany, bo system działa bez usług zewnętrznych. Transkrypcja jest
              niżej, a fragmenty otwierają oryginał we właściwej sekundzie.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {timestamps.length ? (
                timestamps.map((evidence) =>
                  evidence ? (
                    <a
                      key={evidence.link}
                      href={evidence.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-medium text-[13px] text-primary-700 hover:underline"
                    >
                      Otwórz od {fmtSeconds(evidence.timestamp_s ?? 0)}
                      <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    </a>
                  ) : null,
                )
              ) : (
                <a
                  href={detail.material.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-[13px] text-primary-700 hover:underline"
                >
                  Otwórz oryginał
                  <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        ) : null}
        {layer === "html" && detail.material.has_snapshot ? (
          <iframe
            title="Kopia strony z dnia pobrania"
            src={withBasePath(`/api/incidents/${detail.id}/snapshot`)}
            sandbox=""
            className="h-[460px] w-full rounded-md border border-line-200 bg-surface-0"
          />
        ) : null}
        {layer === "html" && !detail.material.has_snapshot ? (
          <EmptyState illustration="archiwum" title="Brak kopii HTML">
            Dla tego materiału nie zapisano kopii strony.
          </EmptyState>
        ) : null}
        {layer === "dane" ? (
          <pre className="max-h-[460px] overflow-auto rounded-md bg-surface-1 p-3 font-mono text-ink-700 text-xs leading-5">
            {JSON.stringify(
              {
                material: { ...detail.material, text: `${detail.material.text.length} znaków` },
                details: detail.details,
              },
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    </Card>
  );
}

// ─── Prawa kolumna ──────────────────────────────────────────────────────────────────────────

function WhyFlagged({
  detail,
  threshold,
  active,
  onActive,
}: {
  detail: IncidentDetail;
  threshold: ModuleThreshold;
  active: string | null;
  onActive: (rule: string | null) => void;
}) {
  const [showOk, setShowOk] = useState(false);
  const high = detail.score >= threshold.alert;
  const violations = detail.details.flags
    .filter((flag) => flag.result === "violation")
    .sort((a, b) => b.confidence - a.confidence);
  const rest = detail.details.flags.filter((flag) => flag.result !== "violation");
  return (
    <Card className="p-4">
      <SectionTitle>Dlaczego oflagowano</SectionTitle>
      <p className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "tnum font-semibold text-[28px] leading-8",
            high ? "text-risk-700" : "text-ink-900",
          )}
        >
          {fmtScore(detail.score)}
        </span>
        <span className={cn("text-sm", high ? "text-risk-700" : "text-ink-600")}>
          {high ? "wysokie" : "średnie"}
        </span>
      </p>
      <div className="relative mt-3 mb-9 h-1 rounded-full bg-line-200" aria-hidden="true">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            high ? "bg-risk-700" : "bg-ink-500",
          )}
          style={{ width: `${detail.score * 100}%` }}
        />
        {[
          { value: threshold.flag, label: `próg flagi ${fmtScore(threshold.flag)}` },
          { value: threshold.alert, label: `alert ${fmtScore(threshold.alert)}` },
        ].map((tick) => (
          <span
            key={tick.label}
            className="absolute -top-1"
            style={{ left: `${tick.value * 100}%` }}
          >
            <span className="block h-3 w-px bg-ink-900" />
            <span className="absolute top-4 -translate-x-1/2 whitespace-nowrap text-[11px] text-ink-600">
              {tick.label}
            </span>
          </span>
        ))}
      </div>
      {detail.details.error ? (
        <p className="mb-3 rounded-md bg-warning-100 px-3 py-2 text-[13px] text-warning-800">
          Analiza zgłosiła błąd: {detail.details.error}
        </p>
      ) : null}
      {detail.details.summary ? (
        <p className="mb-3 text-[13px] text-ink-700">{detail.details.summary}</p>
      ) : null}
      <ol className="flex flex-col gap-2">
        {violations.map((flag, index) => (
          <li
            key={flag.rule_id}
            onMouseEnter={() => onActive(flag.rule_id)}
            onMouseLeave={() => onActive(null)}
            className={cn(
              "rounded-md bg-surface-1 p-3 transition-colors duration-150",
              active === flag.rule_id && "bg-risk-50",
            )}
          >
            <p className="font-medium text-ink-900 text-sm">
              {index + 1}.{" "}
              {flag.evidence
                ? `„${flag.evidence.quote}”`
                : flag.rule_name || `Reguła ${flag.rule_id}`}
            </p>
            {flag.evidence && flag.rule_name ? (
              <p className="mt-0.5 text-[13px] text-ink-600">{flag.rule_name}</p>
            ) : null}
            {flag.reason ? <p className="mt-1 text-[13px] text-ink-700">{flag.reason}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Tip
                label={flag.kind === "hard" ? "Wymóg z przepisu" : "Zalecenie, nie wymóg"}
                className="max-w-full"
              >
                <OutlineChip className="h-auto min-h-6 py-1 text-left">
                  <Scale
                    className="size-3.5 shrink-0 text-ink-600"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  {flag.legal_basis || "podstawa prawna do uzupełnienia"}
                </OutlineChip>
              </Tip>
              <Tip label="Pewność modelu dla tej reguły">
                <OutlineChip>
                  <Gauge className="size-3.5 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
                  <span className="tnum">{fmtScore(flag.confidence)}</span>
                </OutlineChip>
              </Tip>
              {flag.evidence?.timestamp_s !== null && flag.evidence?.timestamp_s !== undefined ? (
                <a
                  href={flag.evidence.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-6 items-center gap-1 font-medium text-primary-700 text-xs hover:underline"
                >
                  {fmtSeconds(flag.evidence.timestamp_s)}
                  <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {violations.length === 0 ? (
        <p className="text-[13px] text-ink-600">Model nie wskazał naruszonej reguły.</p>
      ) : null}
      {rest.length ? (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showOk}
            onClick={() => setShowOk((value) => !value)}
            className="inline-flex items-center gap-1 text-[13px] text-ink-700 hover:text-ink-900"
          >
            Bez uwag: {rest.length} {plural(rest.length, "reguła", "reguły", "reguł")}
            <ChevronDown
              className={cn("size-3.5 transition-transform", showOk && "rotate-180")}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </button>
          {showOk ? (
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-ink-600">
              {rest.map((flag) => (
                <li key={flag.rule_id}>
                  {flag.rule_name || `Reguła ${flag.rule_id}`}
                  {flag.result === "n/a" ? " (nie dotyczy)" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function RegistryChip({ entity }: { entity: IncidentEntity }) {
  if (entity.in_register === null && !entity.on_warning_list) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {entity.in_register !== null ? (
        <Tip
          label={
            entity.in_register
              ? `Firma jest w rejestrze podmiotów nadzorowanych przez KNF${entity.knf_id ? ` (nr ${entity.knf_id})` : ""}.`
              : "Firmy nie ma w rejestrze KNF. Może nie mieć zezwolenia na usługi inwestycyjne w Polsce."
          }
        >
          <OutlineChip>{entity.in_register ? "w rejestrze KNF" : "spoza rejestru KNF"}</OutlineChip>
        </Tip>
      ) : null}
      {entity.on_warning_list ? (
        <Tip label="Firma jest na liście ostrzeżeń publicznych KNF.">
          <OutlineChip className="border-risk-700 text-risk-700">lista ostrzeżeń KNF</OutlineChip>
        </Tip>
      ) : null}
    </span>
  );
}

function EntityCard({ detail }: { detail: IncidentDetail }) {
  const entity = detail.details.entity;
  const name = entity.firm_name ?? entity.advertiser;
  if (!name) return null;
  const facts = [
    entity.advertiser && entity.firm_name ? `publikuje: ${entity.advertiser}` : null,
    entity.nip ? `NIP ${entity.nip}` : null,
    entity.domain,
  ].filter(Boolean);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>{name}</SectionTitle>
        <RegistryChip entity={entity} />
      </div>
      {facts.length ? <p className="mt-2 text-[13px] text-ink-600">{facts.join(" · ")}</p> : null}
      {entity.firm_name ? (
        <Link
          href={`/podmiot?nazwa=${encodeURIComponent(entity.firm_name)}`}
          className="mt-3 inline-flex items-center gap-1 font-medium text-[13px] text-primary-700 hover:underline"
        >
          Widok podmiotu
          <ArrowRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        </Link>
      ) : null}
    </Card>
  );
}

// Historia: data jako nagłówek grupy, godzina w stałej kolumnie (decyzja z 22.11). Kontrakt API
// nie ma jeszcze autora i czasu decyzji (R16), więc pokazujemy tylko wpis systemu i obecny status.
function HistoryCard({
  detail,
  threshold,
}: {
  detail: IncidentDetail;
  threshold: ModuleThreshold;
}) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-[13px] text-ink-700">
        <History className="size-4 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
        Historia
      </p>
      <p className="mt-2 text-ink-600 text-xs">{fmtDayHeader(detail.created_at)}</p>
      <p className="mt-1 flex items-center gap-3 text-[13px] text-ink-700">
        <span className="tnum w-10 font-medium text-ink-900">{fmtTime(detail.created_at)}</span>
        <RadioTower className="size-4 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
        system · oflagowano {fmtScore(detail.score)} (próg flagi {fmtScore(threshold.flag)})
      </p>
      {detail.status !== "new" ? (
        <p className="mt-2 flex items-center gap-3 text-[13px] text-ink-700">
          <span className="w-10" />
          <StatusGlyph status={detail.status} />
          obecny status: {STATUS_LABEL[detail.status]}
        </p>
      ) : null}
    </Card>
  );
}

// ─── Okno sprawy ────────────────────────────────────────────────────────────────────────────

export function CaseWindow({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const params = readQueueParams(search);
  const suffix = queueSearch(params);
  const detail = useIncident(id);
  const thresholds = useThresholds();
  const list = useIncidents(queueFilters(params));
  const setStatus = useSetStatus();
  const [active, setActive] = useState<string | null>(null);
  const opened = useRef<string | null>(null);

  const flat = buildQueue(list.data?.items ?? [], params, thresholds.data).flatMap(
    (group) => group.items,
  );
  const position = flat.findIndex((item) => item.id === id);
  const previous = position > 0 ? flat[position - 1] : undefined;
  const next = position >= 0 ? flat[position + 1] : flat[0];

  // Otwarcie nowego materiału = „W trakcie” (R6), żeby druga osoba widziała, że ktoś go ogląda.
  useEffect(() => {
    if (detail.data?.status === "new" && opened.current !== id) {
      opened.current = id;
      setStatus.mutate({ id, status: "in_review" });
    }
  }, [detail.data?.status, id, setStatus]);

  function go(target: { id: string } | undefined) {
    if (target) router.push(`/kolejka/${target.id}${suffix}`);
  }

  function undo() {
    const decision = lastDecision;
    if (!decision) return;
    lastDecision = null;
    setStatus
      .mutateAsync({ id: decision.id, status: decision.previous })
      .then(() => {
        toast.success("Cofnięto decyzję");
        router.push(`/kolejka/${decision.id}${suffix}`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Błąd"));
  }

  function decide(status: "confirmed" | "dismissed") {
    const current = detail.data;
    if (!current || setStatus.isPending) return;
    const target = next ?? previous;
    setStatus
      .mutateAsync({ id, status })
      .then(() => {
        lastDecision = {
          id,
          previous: current.status === "new" ? "in_review" : current.status,
        };
        showDecisionToast(`${DECISION_TEXT[status]}: ${detailTitle(current)}`, undo);
        if (target && target.id !== id) go(target);
        else router.push(`/kolejka${suffix}`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Błąd"));
  }

  useHotkeys({
    "1": () => decide("confirmed"),
    "2": () => decide("dismissed"),
    j: () => go(next),
    k: () => go(previous),
    Escape: () => router.push(`/kolejka${suffix}`),
    "ctrl+z": undo,
  });

  if (detail.error) return <ErrorNote error={detail.error} />;
  if (!detail.data || !thresholds.data) {
    return (
      <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  const data = detail.data;
  const threshold = thresholds.data[data.module];
  const groupName = entityName({
    firm_name: data.details.entity.firm_name,
    advertiser: data.details.entity.advertiser,
  });
  const inGroup = flat.filter((item) => entityName(item) === groupName);
  const groupIndex = inGroup.findIndex((item) => item.id === id);

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-4">
      <div className="flex items-center justify-between text-[13px] text-ink-600">
        <nav aria-label="Ścieżka" className="flex items-center gap-2">
          <Link href={`/kolejka${suffix}`} className="hover:text-ink-900 hover:underline">
            Kolejka
          </Link>
          {groupName ? (
            <>
              <ChevronRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span>{groupName}</span>
            </>
          ) : null}
          {groupIndex >= 0 ? (
            <>
              <ChevronRight className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span>
                materiał {groupIndex + 1} z {inGroup.length}
              </span>
            </>
          ) : null}
        </nav>
        <span className="flex items-center gap-3">
          <button
            type="button"
            disabled={!previous}
            onClick={() => go(previous)}
            className="hover:text-ink-900 disabled:text-ink-400"
          >
            K poprzedni
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            disabled={!next}
            onClick={() => go(next)}
            className="hover:text-ink-900 disabled:text-ink-400"
          >
            J następny
          </button>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold text-[22px] text-ink-900 leading-7">{detailTitle(data)}</h1>
          <Chip>
            {MODULE_SHORT[data.module]} · {labelText(data.label)}
          </Chip>
          <PlatformLabel platform={data.material.platform} className="text-[13px]" />
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-700">
            <StatusGlyph status={data.status} />
            {STATUS_LABEL[data.status]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-600">
          <span className="group inline-flex items-center gap-1">
            <a
              href={data.material.url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[420px] truncate text-primary-700 underline underline-offset-2"
            >
              {hostOf(data.material.url)}
            </a>
            <span className="flex opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
              <Tip label="Kopiuj URL">
                <button
                  type="button"
                  aria-label="Kopiuj URL"
                  onClick={() => {
                    void navigator.clipboard.writeText(data.material.url);
                    toast.success("Skopiowano adres materiału");
                  }}
                  className="inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-hover hover:text-ink-900"
                >
                  <Copy className="size-4" strokeWidth={1.5} />
                </button>
              </Tip>
              <Tip label="Otwórz oryginał">
                <a
                  href={data.material.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Otwórz oryginał"
                  className="inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-hover hover:text-ink-900"
                >
                  <ExternalLink className="size-4" strokeWidth={1.5} />
                </a>
              </Tip>
            </span>
          </span>
          {data.material.published_at ? (
            <span>opublikowano {fmtDateTime(data.material.published_at)}</span>
          ) : null}
          <span>pobrano {fmtDateTime(data.material.scraped_at)}</span>
          <span>oflagowano {fmtDateTime(data.created_at)}</span>
          {data.material.has_snapshot ? (
            <span className="inline-flex items-center gap-1.5">
              <Fingerprint className="size-4" strokeWidth={1.5} aria-hidden="true" />
              kopia {fmtDateTime(data.material.scraped_at)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-1 px-3 py-2.5">
        <Button
          variant="primary"
          shortcut="1"
          aria-pressed={data.status === "confirmed"}
          disabled={setStatus.isPending}
          onClick={() => decide("confirmed")}
        >
          Potwierdź naruszenie
        </Button>
        <Button
          shortcut="2"
          aria-pressed={data.status === "dismissed"}
          disabled={setStatus.isPending}
          onClick={() => decide("dismissed")}
        >
          Fałszywy alarm
        </Button>
        <p className="ml-auto text-[13px] text-ink-600">
          Decyzja dotyczy tylko tego materiału. Potem toast z Cofnij i następny.
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <CopyPanel key={data.id} detail={data} />
          <Card className="p-4">
            <p className="mb-2 font-medium text-ink-600 text-xs">
              {data.material.platform === "youtube" ? "Opis i transkrypcja" : "Treść materiału"} (z
              kopii)
            </p>
            <MaterialText
              text={data.material.text}
              flags={data.details.flags}
              active={active}
              onActive={setActive}
            />
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <WhyFlagged detail={data} threshold={threshold} active={active} onActive={setActive} />
          <EntityCard detail={data} />
          <HistoryCard detail={data} threshold={threshold} />
        </div>
      </div>
    </div>
  );
}
