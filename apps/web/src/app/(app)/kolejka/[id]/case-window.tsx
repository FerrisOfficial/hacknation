"use client";

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
  TriangleAlert,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PlatformLabel, StatusGlyph } from "@/components/iw/icons";
import { RegistryChip } from "@/components/iw/registry";
import { showDecisionToast } from "@/components/iw/toasts";
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNote,
  Kbd,
  OutlineChip,
  SectionTitle,
  Skeleton,
  Tabs,
  Tip,
} from "@/components/iw/ui";
import type { ModuleThreshold } from "@/lib/analysis/modules";
import { withBasePath } from "@/lib/base-path";
import {
  frameUrl,
  useIncident,
  useIncidents,
  useSetStatus,
  useThresholds,
  videoUrl,
} from "@/lib/client/api";
import type { HistoryEntry, UiDetail, UiFlag, UiStatus } from "@/lib/client/contract-ui";
import {
  fmtDateTime,
  fmtDayHeader,
  fmtScore,
  fmtTime,
  hostOf,
  labelText,
  MODULE_SHORT,
  plural,
  reviewText,
  STATUS_LABEL,
  shortName,
  statusLabelFor,
} from "@/lib/client/format";
import { useHotkeys } from "@/lib/client/hotkeys";
import {
  buildQueue,
  entityName,
  escalationText,
  isEscalated,
  queueFilters,
  queueSearch,
  readQueueParams,
} from "@/lib/client/queue";
import { cn } from "@/lib/utils";

// Ostatnia decyzja w tej karcie przeglądarki. Poza komponentem, bo po decyzji Okno sprawy
// przechodzi do następnego materiału, a Ctrl+Z i „Cofnij” w toaście mają nadal działać (R5).
let lastDecision: { id: string; previous: UiStatus; note: string | null } | null = null;

type Decision = "confirmed" | "dismissed" | "postponed";

const DECISION_TEXT: Record<Decision, string> = {
  confirmed: "Potwierdzono naruszenie",
  dismissed: "Oznaczono jako fałszywy alarm",
  postponed: "Odłożono",
};

// Moduł 1: decyzja „czy to reklama firmy inwestycyjnej przez osobę trzecią” (R18).
const AD_DECISION_TEXT: Record<Decision, string> = {
  confirmed: "Dodano do rejestru reklam",
  dismissed: "Oznaczono: to nie reklama",
  postponed: "Odłożono",
};

const POSTPONE_REASONS = ["dowód niepełny", "czekam na nowe materiały podmiotu", "do konsultacji"];

function detailTitle(detail: UiDetail): string {
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

function evidenceTime(flag: UiFlag): number | null {
  return flag.evidence?.frame?.ts ?? flag.evidence?.timestamp_s ?? null;
}

// ─── Treść z podkreślonymi fragmentami (R3) ─────────────────────────────────────────────────

type Segment = { text: string; rule?: string };

function segments(text: string, flags: UiFlag[]): Segment[] {
  const ranges: { start: number; end: number; rule: string }[] = [];
  for (const flag of flags) {
    const evidence = flag.evidence;
    // Dowód z klatki nie ma pozycji w tekście (docs/KONTRAKT.md §3): nie podświetlamy.
    if (flag.result !== "violation" || !evidence || evidence.frame) continue;
    if (evidence.start === null || evidence.end === null) continue;
    if (evidence.end <= evidence.start || evidence.end > text.length) continue;
    ranges.push({ start: evidence.start, end: evidence.end, rule: flag.rule_id });
  }
  ranges.sort((a, b) => a.start - b.start);
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
  flags: UiFlag[];
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

// Klatka z ramką cytatu: `box` to ułamki 0–1 szerokości i wysokości klatki.
function FrameShot({
  id,
  flag,
  active,
  onSeek,
  onActive,
}: {
  id: string;
  flag: UiFlag;
  active: boolean;
  onSeek: (seconds: number) => void;
  onActive: (rule: string | null) => void;
}) {
  const frame = flag.evidence?.frame;
  if (!frame) return null;
  const [x0, y0, x1, y1] = frame.box;
  const time = evidenceTime(flag);
  return (
    <button
      type="button"
      onClick={() => (time !== null ? onSeek(time) : undefined)}
      onMouseEnter={() => onActive(flag.rule_id)}
      onMouseLeave={() => onActive(null)}
      className={cn(
        "flex w-[220px] shrink-0 flex-col gap-1 rounded-md border p-1 text-left transition-colors duration-150",
        active ? "border-risk-700 bg-risk-50" : "border-line-200 hover:bg-surface-hover",
      )}
    >
      <span className="relative block overflow-hidden rounded bg-ink-900">
        {/* biome-ignore lint/performance/noImgElement: klatka z API, rozmiar nieznany z góry */}
        <img
          src={frameUrl(id, frame.file)}
          alt={`Klatka z ${fmtSeconds(time ?? 0)}`}
          className="block w-full"
        />
        <span
          aria-hidden="true"
          className="absolute rounded-sm border-2 border-risk-700"
          style={{
            left: `${x0 * 100}%`,
            top: `${y0 * 100}%`,
            width: `${(x1 - x0) * 100}%`,
            height: `${(y1 - y0) * 100}%`,
          }}
        />
      </span>
      <span className="px-1 text-ink-700 text-xs">
        <span className="tnum font-medium text-ink-900">{fmtSeconds(time ?? 0)}</span> · reguła{" "}
        {flag.rule_id}
      </span>
    </button>
  );
}

function VideoPanel({
  detail,
  seek,
  onSeek,
  active,
  onActive,
}: {
  detail: UiDetail;
  seek: { t: number; n: number } | null;
  onSeek: (seconds: number) => void;
  active: string | null;
  onActive: (rule: string | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const violations = detail.details.flags.filter(
    (flag) => flag.result === "violation" && evidenceTime(flag) !== null,
  );
  const first = violations.map(evidenceTime).find((value) => value !== null) ?? null;
  const frames = violations.filter((flag) => flag.evidence?.frame);

  useEffect(() => {
    const video = ref.current;
    if (video && seek) {
      video.currentTime = seek.t;
      void video.play().catch(() => undefined);
    }
  }, [seek]);

  return (
    <div className="flex flex-col gap-3">
      {detail.material.has_video ? (
        // biome-ignore lint/a11y/useMediaCaption: transkrypcja jest w karcie pod filmem
        <video
          ref={ref}
          controls
          preload="metadata"
          src={videoUrl(detail.id)}
          // Film startuje od sekundy oflagowanego fragmentu.
          onLoadedMetadata={(event) => {
            if (first !== null && !seek) event.currentTarget.currentTime = first;
          }}
          className="aspect-video w-full rounded-md bg-ink-900"
        />
      ) : (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-md bg-surface-1 px-6 py-8 text-center">
          <span className="flex size-10 items-center justify-center rounded-full border border-line-300 bg-surface-0">
            <Video className="size-4 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="max-w-md text-[13px] text-ink-600">
            Film nie jest jeszcze pobrany. Transkrypcja jest niżej, a oryginał otworzysz w YouTube.
          </p>
          <a
            href={`${detail.material.url}${first !== null ? `&t=${Math.floor(first)}s` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-medium text-[13px] text-primary-700 hover:underline"
          >
            Otwórz w YouTube{first !== null ? ` od ${fmtSeconds(first)}` : ""}
            <ExternalLink className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          </a>
        </div>
      )}
      {violations.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-600">Oflagowane momenty:</span>
          {violations.map((flag) => {
            const time = evidenceTime(flag) ?? 0;
            return (
              <button
                key={flag.rule_id}
                type="button"
                onClick={() => onSeek(time)}
                onMouseEnter={() => onActive(flag.rule_id)}
                onMouseLeave={() => onActive(null)}
                className={cn(
                  "tnum inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-medium text-xs transition-colors duration-150",
                  active === flag.rule_id
                    ? "border-risk-700 bg-risk-50 text-risk-700"
                    : "border-ink-400 text-ink-700 hover:bg-surface-hover",
                )}
              >
                {fmtSeconds(time)}
              </button>
            );
          })}
        </div>
      ) : null}
      {frames.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {frames.map((flag) => (
            <FrameShot
              key={flag.rule_id}
              id={detail.id}
              flag={flag}
              active={active === flag.rule_id}
              onSeek={onSeek}
              onActive={onActive}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyPanel({
  detail,
  seek,
  onSeek,
  active,
  onActive,
}: {
  detail: UiDetail;
  seek: { t: number; n: number } | null;
  onSeek: (seconds: number) => void;
  active: string | null;
  onActive: (rule: string | null) => void;
}) {
  const isVideo = detail.material.platform === "youtube";
  const [layer, setLayer] = useState<Layer>(
    isVideo ? "wideo" : detail.material.has_snapshot ? "html" : "dane",
  );
  useEffect(() => {
    if (seek && isVideo) setLayer("wideo");
  }, [seek, isVideo]);

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
          <VideoPanel
            detail={detail}
            seek={seek}
            onSeek={onSeek}
            active={active}
            onActive={onActive}
          />
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
  onSeek,
}: {
  detail: UiDetail;
  threshold: ModuleThreshold;
  active: string | null;
  onActive: (rule: string | null) => void;
  onSeek: (seconds: number) => void;
}) {
  const [showOk, setShowOk] = useState(false);
  // Risk score (backend, @/lib/analysis/risk) z naruszeń ponad progiem flagi; próg porównujemy
  // z wynikiem każdego naruszenia osobno.
  const ads = detail.module === "finfluencer";
  const risk = detail.risk_score ?? detail.score;
  // M1: wynik to pewność, że to reklama — bez kategorii ryzyka i bez koloru (R18).
  const high = !ads && risk >= threshold.alert;
  const escalated = ads && isEscalated({ module: detail.module, ...detail.details.entity });
  const ruleScore = (flag: UiFlag) => flag.score ?? flag.confidence;
  // Naruszenie = reguła ze score ≥ próg flagi (ten sam score decyduje o liście i o risk score);
  // reguły bez score'u (M1) — według etykiety modelu.
  const isViolation = (flag: UiFlag) =>
    flag.score === null ? flag.result === "violation" : flag.score >= threshold.flag;
  const violations = detail.details.flags
    .filter(isViolation)
    .sort((a, b) => ruleScore(b) - ruleScore(a));
  const aboveFlag = violations.filter((flag) => ruleScore(flag) >= threshold.flag).length;
  const rest = detail.details.flags.filter((flag) => !isViolation(flag));
  return (
    <Card className="p-4">
      <SectionTitle>{ads ? "Dlaczego to reklama" : "Dlaczego oflagowano"}</SectionTitle>
      {escalated ? (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-warning-100 px-3 py-2 text-[13px] text-warning-800">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          Sygnał naruszenia: {escalationText(detail.details.entity)}.
        </p>
      ) : null}
      <p className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "tnum font-semibold text-[28px] leading-8",
            high ? "text-risk-700" : "text-ink-900",
          )}
        >
          {fmtScore(risk)}
        </span>
        <span className={cn("text-sm", high ? "text-risk-700" : "text-ink-600")}>
          {ads ? "pewność, że to reklama" : `risk score · ${high ? "wysokie" : "średnie"}`}
        </span>
      </p>
      {ads ? (
        <p className="mt-1 mb-3 text-[13px] text-ink-600">
          Reklama firmy inwestycyjnej publikowana przez osobę trzecią trafia do rejestru reklam. To
          nie jest naruszenie samo w sobie.
        </p>
      ) : null}
      <p className={cn("mt-1 mb-3 text-[13px] text-ink-600", ads && "hidden")}>
        Z naruszeń ponad próg flagi {fmtScore(threshold.flag)}: {aboveFlag}{" "}
        {plural(aboveFlag, "naruszenie", "naruszenia", "naruszeń")}. Im więcej wysokich, tym wyżej;
        naruszenia poniżej progu się nie liczą (alert od {fmtScore(threshold.alert)}).
      </p>
      {detail.details.error ? (
        <p className="mb-3 rounded-md bg-warning-100 px-3 py-2 text-[13px] text-warning-800">
          Analiza zgłosiła błąd: {detail.details.error}
        </p>
      ) : null}
      {detail.details.summary ? (
        <p className="mb-3 text-[13px] text-ink-700">{detail.details.summary}</p>
      ) : null}
      <ol className="flex flex-col gap-2">
        {violations.map((flag, index) => {
          const time = evidenceTime(flag);
          return (
            <li
              key={flag.rule_id}
              onMouseEnter={() => onActive(flag.rule_id)}
              onMouseLeave={() => onActive(null)}
              className={cn(
                "rounded-md bg-surface-1 p-3 transition-colors duration-150",
                active === flag.rule_id && "bg-risk-50",
                ruleScore(flag) < threshold.flag && "opacity-60",
              )}
            >
              <p className="font-medium text-ink-900 text-sm">
                {index + 1}.{" "}
                {flag.evidence
                  ? `„${flag.evidence.quote}”`
                  : flag.rule_name || `Reguła ${flag.rule_id}`}
              </p>
              {flag.evidence && flag.rule_name ? (
                <p className="mt-0.5 text-[13px] text-ink-600">
                  {flag.rule_name}
                  {flag.evidence.frame ? " · tekst z klatki filmu" : ""}
                </p>
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
                <Tip label="Wynik naruszenia, porównywany z progiem flagi i alertu">
                  <OutlineChip
                    className={cn(
                      ruleScore(flag) >= threshold.alert && "border-risk-700 text-risk-700",
                    )}
                  >
                    <Gauge className="size-3.5 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
                    <span className="tnum">{fmtScore(ruleScore(flag))}</span>
                    {ruleScore(flag) >= threshold.alert
                      ? " · ponad alert"
                      : ruleScore(flag) >= threshold.flag
                        ? " · ponad próg"
                        : " · poniżej progu"}
                  </OutlineChip>
                </Tip>
                {time !== null && detail.material.platform === "youtube" ? (
                  <Tip label="Przewiń film do tego momentu">
                    <button
                      type="button"
                      onClick={() => onSeek(time)}
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-line-300 px-2.5 font-medium text-primary-700 text-xs hover:bg-primary-50"
                    >
                      <Video className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                      <span className="tnum">{fmtSeconds(time)}</span>
                    </button>
                  </Tip>
                ) : null}
              </div>
            </li>
          );
        })}
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

// Moduł 3: przesłanki doradztwa inwestycyjnego (art. 76 ustawy o obrocie) — score 0-1 każdej.
// Kolejność = waga w modelu; pasek tylko w szarości, wysoka przesłanka pogrubiona (R6, R12).
const ADVISORY_SIGNALS: { key: string; label: string; hint: string }[] = [
  { key: "offer", label: "Oferta doradztwa / zarządzania", hint: "usługa dla klientów" },
  { key: "personal", label: "Dopasowanie do klienta", hint: "potrzeby i sytuacja klienta" },
  { key: "recommendation", label: "Rekomendacje instrumentów", hint: "kup / sprzedaj / trzymaj" },
  { key: "paid", label: "Odpłatność, konsultacje", hint: "pozyskiwanie klientów" },
  { key: "claims", label: "Powołanie na uprawnienia", hint: "licencja, certyfikat" },
  { key: "disclaimer", label: "„To nie jest doradztwo”", hint: "przy ofercie indywidualnej" },
];

function AdvisorySignals({ detail }: { detail: UiDetail }) {
  const signals = detail.details.signals;
  if (detail.module !== "unauthorized_advisory" || !signals) return null;
  const entity = detail.details.entity;
  const registry =
    entity.on_warning_list === true
      ? "na liście ostrzeżeń KNF"
      : entity.in_register === true
        ? "ma zezwolenie KNF"
        : entity.in_register === false
          ? "brak w rejestrze KNF"
          : "rejestr KNF: nie ustalono";
  return (
    <Card className="p-4">
      <SectionTitle>Przesłanki doradztwa</SectionTitle>
      <p className="mt-1 text-[13px] text-ink-600">
        Art. 76 ustawy o obrocie: rekomendacja dotycząca instrumentów finansowych, przygotowana dla
        konkretnego klienta. Podmiot: {registry}.
      </p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {ADVISORY_SIGNALS.map(({ key, label, hint }) => {
          const value = signals[key] ?? 0;
          const strong = value >= 0.5;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className={cn(strong ? "font-medium text-ink-900" : "text-ink-600")}>
                  {label} <span className="text-ink-500 text-xs">· {hint}</span>
                </span>
                <span className={cn("tnum", strong ? "text-ink-900" : "text-ink-500")}>
                  {fmtScore(value)}
                </span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-line-200" aria-hidden="true">
                <span
                  className={cn("block h-1 rounded-full", strong ? "bg-ink-900" : "bg-ink-500")}
                  style={{ width: `${value * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function EntityCard({ detail, related }: { detail: UiDetail; related: string | null }) {
  const entity = detail.details.entity;
  const name = entity.firm_name ?? entity.advertiser;
  if (!name) return null;
  const contact = detail.details.contact;
  const facts = [
    entity.advertiser && entity.firm_name ? `publikuje: ${entity.advertiser}` : null,
    entity.nip ? `NIP ${entity.nip}` : null,
    entity.domain,
    ...(contact?.emails ?? []),
    ...(contact?.phones ?? []),
  ].filter(Boolean);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>{name}</SectionTitle>
        <RegistryChip entity={entity} />
      </div>
      {facts.length ? <p className="mt-2 text-[13px] text-ink-600">{facts.join(" · ")}</p> : null}
      {related ? <p className="mt-1 text-[13px] text-ink-600">{related}</p> : null}
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

// Historia: data jako nagłówek grupy, godzina w stałej kolumnie cyframi tabelarycznymi
// (decyzja z 22.11). Pełna historia przychodzi z API (`history`); bez niej składamy ją
// z oflagowania i ostatniej decyzji.
function historyOf(detail: UiDetail, threshold: ModuleThreshold): HistoryEntry[] {
  if (detail.history?.length) {
    return [...detail.history].sort((a, b) => b.at.localeCompare(a.at));
  }
  const entries: HistoryEntry[] = [];
  if (detail.status !== "new") {
    entries.push({
      at: detail.reviewed_at ?? detail.created_at,
      actor: detail.reviewed_by ?? null,
      action: detail.review_note
        ? `${STATUS_LABEL[detail.status]}: ${detail.review_note}`
        : STATUS_LABEL[detail.status],
      status: detail.status,
    });
  }
  entries.push({
    at: detail.created_at,
    actor: null,
    action: `oflagowano ${fmtScore(detail.score)} przy progu ${fmtScore(threshold.flag)}`,
  });
  return entries;
}

function HistoryCard({ detail, threshold }: { detail: UiDetail; threshold: ModuleThreshold }) {
  const entries = historyOf(detail, threshold);
  let lastDay = "";
  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-[13px] text-ink-700">
        <History className="size-4 text-ink-600" strokeWidth={1.5} aria-hidden="true" />
        Historia
      </p>
      <ul className="mt-1 flex flex-col">
        {entries.map((entry) => {
          const day = fmtDayHeader(entry.at);
          const header = day !== lastDay ? day : null;
          lastDay = day;
          return (
            <li key={`${entry.at}-${entry.action}`}>
              {header ? <p className="mt-2 text-ink-600 text-xs">{header}</p> : null}
              <p className="mt-1 flex items-center gap-3 text-[13px] text-ink-700">
                <span className="tnum w-10 shrink-0 font-medium text-ink-900">
                  {fmtTime(entry.at)}
                </span>
                {entry.actor ? (
                  <Avatar reviewer={entry.actor} />
                ) : (
                  <RadioTower
                    className="size-4 shrink-0 text-ink-600"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                )}
                <span>
                  {entry.actor ? shortName(entry.actor) : "system"} · {entry.action}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Pasek decyzji ──────────────────────────────────────────────────────────────────────────

type Menu = "dismissed" | "postponed" | null;

// Panel powodu po klawiszu 2 (Fałszywy alarm) i 3 (Odłóż): w otwartym panelu 1–3 wybiera powód.
function reasonsFor(menu: Exclude<Menu, null>, ads: boolean): { label: string; note?: string }[] {
  if (menu === "postponed")
    return POSTPONE_REASONS.map((reason) => ({ label: reason, note: reason }));
  return ads
    ? [
        { label: "bez powodu" },
        { label: "to treść edukacyjna, nie reklama", note: "treść edukacyjna" },
        { label: "brak związku z firmą", note: "brak związku z firmą" },
      ]
    : [
        { label: "bez powodu" },
        {
          label: "informacja o ryzyku jest, model jej nie widzi",
          note: "informacja o ryzyku jest",
        },
        {
          label: "materiał nie dotyczy usług inwestycyjnych",
          note: "nie dotyczy usług inwestycyjnych",
        },
      ];
}

function DecisionBar({
  ads,
  status,
  pending,
  blocked,
  menu,
  setMenu,
  onDecide,
}: {
  ads: boolean;
  status: UiStatus;
  pending: boolean;
  // Powód, dla którego potwierdzenie jest wyłączone (brak kopii, R4), albo null.
  blocked: string | null;
  menu: Menu;
  setMenu: (menu: Menu) => void;
  onDecide: (decision: Decision, note?: string) => void;
}) {
  const panel = (kind: Exclude<Menu, null>) =>
    menu === kind ? (
      <span
        role="menu"
        className="absolute top-full left-0 z-40 mt-1 flex w-80 flex-col rounded-lg border border-line-200 bg-surface-0 p-1 shadow-lg"
      >
        <span className="px-3 pt-1.5 pb-1 text-ink-600 text-xs">
          {kind === "postponed" ? "Dlaczego odkładasz?" : "Powód (opcjonalnie)"} · Esc zamyka
        </span>
        {reasonsFor(kind, ads).map((reason, index) => (
          <button
            key={reason.label}
            type="button"
            role="menuitem"
            onClick={() => onDecide(kind, reason.note)}
            className="flex h-9 items-center justify-between gap-3 rounded-md px-3 text-left text-ink-900 text-sm hover:bg-surface-hover"
          >
            {reason.label}
            <Kbd>{index + 1}</Kbd>
          </button>
        ))}
      </span>
    ) : null;

  const confirm = (
    <Button
      variant="primary"
      shortcut="1"
      aria-pressed={status === "confirmed"}
      disabled={pending || Boolean(blocked)}
      onClick={() => onDecide("confirmed")}
    >
      {ads ? "To reklama" : "Potwierdź naruszenie"}
    </Button>
  );
  return (
    <div className="relative flex flex-wrap items-center gap-3 rounded-lg bg-surface-1 px-3 py-2.5">
      {blocked ? <Tip label={blocked}>{confirm}</Tip> : <Tip label="Skrót: 1">{confirm}</Tip>}
      <span className="relative">
        <Tip label="Skrót: 2, potem powód 1–3">
          <Button
            shortcut="2"
            aria-pressed={status === "dismissed"}
            aria-expanded={menu === "dismissed"}
            disabled={pending}
            onClick={() => setMenu(menu === "dismissed" ? null : "dismissed")}
          >
            {ads ? "To nie reklama" : "Fałszywy alarm"}
          </Button>
        </Tip>
        {panel("dismissed")}
      </span>
      <span className="relative">
        <Tip label="Skrót: 3, potem powód 1–3">
          <Button
            shortcut="3"
            aria-pressed={status === "postponed"}
            aria-expanded={menu === "postponed"}
            disabled={pending}
            onClick={() => setMenu(menu === "postponed" ? null : "postponed")}
          >
            Odłóż
          </Button>
        </Tip>
        {panel("postponed")}
      </span>
      <p className="ml-auto text-[13px] text-ink-600">
        {blocked ?? "Decyzja dotyczy tylko tego materiału. Potem toast z Cofnij i następny."}
      </p>
    </div>
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
  const [seek, setSeek] = useState<{ t: number; n: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
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

  function onSeek(seconds: number) {
    setSeek((current) => ({ t: seconds, n: (current?.n ?? 0) + 1 }));
  }

  function go(target: { id: string } | undefined) {
    if (target) router.push(`/kolejka/${target.id}${suffix}`);
  }

  function undo() {
    const decision = lastDecision;
    if (!decision) return;
    lastDecision = null;
    setStatus
      .mutateAsync({
        id: decision.id,
        status: decision.previous,
        note: decision.note ?? undefined,
      })
      .then(() => {
        toast.success("Cofnięto decyzję");
        router.push(`/kolejka/${decision.id}${suffix}`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Błąd"));
  }

  function decide(status: Decision, note?: string) {
    const current = detail.data;
    if (!current || setStatus.isPending) return;
    setMenu(null);
    const target = next ?? previous;
    setStatus
      .mutateAsync({ id, status, note })
      .then(() => {
        lastDecision = {
          id,
          previous: current.status === "new" ? "in_review" : current.status,
          note: current.review_note ?? null,
        };
        showDecisionToast(
          `${(current.module === "finfluencer" ? AD_DECISION_TEXT : DECISION_TEXT)[status]}${note ? ` (${note})` : ""}: ${detailTitle(current)}`,
          undo,
        );
        if (target && target.id !== id) go(target);
        else router.push(`/kolejka${suffix}`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Błąd"));
  }

  // Bez kopii z dnia pobrania nie ma czego dołączyć do sprawy (R4): potwierdzenie wyłączone.
  const material = detail.data?.material;
  const blockedReason =
    material && !material.has_snapshot && !material.has_video && !material.text.trim()
      ? "Brak kopii materiału z dnia pobrania: nie da się udokumentować naruszenia. Odłóż albo oznacz."
      : null;

  function pick(index: number) {
    if (!menu || !detail.data) return false;
    const reason = reasonsFor(menu, detail.data.module === "finfluencer")[index];
    if (reason) decide(menu, reason.note);
    return true;
  }

  useHotkeys({
    "1": () => pick(0) || (blockedReason === null && decide("confirmed")),
    "2": () => pick(1) || setMenu(menu === "dismissed" ? null : "dismissed"),
    "3": () => pick(2) || setMenu(menu === "postponed" ? null : "postponed"),
    j: () => go(next),
    k: () => go(previous),
    Escape: () => (menu ? setMenu(null) : router.push(`/kolejka${suffix}`)),
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
  const sameAuthor = data.details.entity.advertiser
    ? (list.data?.items ?? []).filter((item) => item.advertiser === data.details.entity.advertiser)
    : [];
  const related =
    sameAuthor.length > 1
      ? `${data.details.entity.advertiser}: ${sameAuthor.length} ${plural(sameAuthor.length, "otwarty materiał", "otwarte materiały", "otwartych materiałów")}`
      : null;
  const hash = data.material.content_hash;

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
            {reviewText(data).replace(
              STATUS_LABEL[data.status],
              statusLabelFor(data.status, data.module),
            )}
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
          <span>wykryto {fmtDateTime(data.created_at)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Fingerprint className="size-4" strokeWidth={1.5} aria-hidden="true" />
            kopia {fmtDateTime(data.material.scraped_at)}
            {hash ? (
              <Tip label={`SHA-256 ${hash}`}>
                <span className="font-mono text-xs">
                  · SHA-256 {hash.slice(0, 4)}…{hash.slice(-4)}
                </span>
              </Tip>
            ) : null}
          </span>
        </div>
      </div>

      <DecisionBar
        ads={data.module === "finfluencer"}
        status={data.status}
        pending={setStatus.isPending}
        blocked={blockedReason}
        menu={menu}
        setMenu={setMenu}
        onDecide={decide}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <CopyPanel
            key={data.id}
            detail={data}
            seek={seek}
            onSeek={onSeek}
            active={active}
            onActive={setActive}
          />
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
          <WhyFlagged
            detail={data}
            threshold={threshold}
            active={active}
            onActive={setActive}
            onSeek={onSeek}
          />
          <AdvisorySignals detail={data} />
          <EntityCard detail={data} related={related} />
          <HistoryCard detail={data} threshold={threshold} />
        </div>
      </div>
    </div>
  );
}
