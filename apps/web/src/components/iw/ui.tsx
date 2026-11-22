"use client";

import { ChevronDown, X } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Reviewer, UiStatus } from "@/lib/client/contract-ui";
import { fmtScore, initials, reviewText } from "@/lib/client/format";
import { cn } from "@/lib/utils";
import { Illustration, type IllustrationName, StatusGlyph } from "./icons";

// Komponenty z kontraktu UI („Komponenty i stany”). Stan czytelny bez koloru, przejścia 150 ms.

export function Kbd({ children, onPrimary }: { children: ReactNode; onPrimary?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 font-medium font-sans text-[11px] leading-[14px]",
        onPrimary ? "bg-white/20 text-white" : "border border-line-200 bg-surface-1 text-ink-600",
      )}
    >
      {children}
    </kbd>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost";
  shortcut?: string;
  icon?: ReactNode;
};

const BUTTON_VARIANTS = {
  primary:
    "bg-primary-700 text-white hover:bg-primary-800 active:bg-primary-900 disabled:bg-surface-1 disabled:text-ink-400",
  secondary:
    "border border-ink-400 bg-surface-0 text-ink-900 hover:bg-surface-hover disabled:border-line-300 disabled:text-ink-400 disabled:hover:bg-surface-0",
  ghost: "text-ink-700 hover:bg-surface-hover hover:text-ink-900 disabled:text-ink-400",
};

export function Button({
  variant = "secondary",
  shortcut,
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 font-medium text-sm transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {shortcut ? <Kbd onPrimary={variant === "primary"}>{shortcut}</Kbd> : null}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  className,
  children,
  icon,
  shortcut,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
  shortcut?: string;
}) {
  return (
    <Link
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3.5 font-medium text-sm transition-colors duration-150 ease-out",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {shortcut ? <Kbd onPrimary={variant === "primary"}>{shortcut}</Kbd> : null}
    </Link>
  );
}

// Tooltip: tło ink-900, biały 12/16, max 280 px, opóźnienie 400 ms, pojawia się też na fokus (R14).
export function Tip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none invisible absolute left-1/2 z-50 w-max max-w-[280px] -translate-x-1/2 rounded-md bg-ink-900 px-2 py-1.5 font-normal text-white text-xs leading-4 opacity-0 transition-opacity delay-0 duration-150",
          "group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-[400ms]",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function Chip({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-surface-1 px-2.5 font-medium text-ink-600 text-xs leading-4",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// Chip z obrysem (np. „w rejestrze KNF”), z tooltipem wyjaśniającym termin.
export function OutlineChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-line-300 bg-surface-0 px-2.5 font-medium text-ink-700 text-xs leading-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

// Chip filtra: biały, ramka ink-400; aktywny: primary-50, tekst i ramka primary-700, × usuwa filtr.
export function FilterSelect<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  allValue,
}: {
  icon: ReactNode;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  allValue: T;
}) {
  const active = value !== allValue;
  const current = options.find((option) => option.value === value)?.label ?? "";
  return (
    <span
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded-full border pr-2 pl-3 font-medium text-xs transition-colors duration-150",
        active
          ? "border-primary-700 bg-primary-50 text-primary-700"
          : "border-ink-400 bg-surface-0 text-ink-700 hover:bg-surface-hover",
      )}
    >
      {icon}
      <span>
        {label}: {current}
      </span>
      {active ? (
        <button
          type="button"
          aria-label={`Usuń filtr ${label}`}
          onClick={() => onChange(allValue)}
          className="relative z-10 -mr-0.5 inline-flex size-5 items-center justify-center rounded-full hover:bg-primary-700/10"
        >
          <X className="size-3.5" strokeWidth={1.5} />
        </button>
      ) : (
        <ChevronDown className="size-3.5 text-ink-500" strokeWidth={1.5} aria-hidden="true" />
      )}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn("absolute inset-0 cursor-pointer opacity-0", active && "right-7")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

// Zakładka: tekst ink-600; aktywna ink-900 600 i podkreślenie 2 px primary-700.
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label,
}: {
  tabs: { value: T; label: ReactNode; count?: number; disabled?: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex items-end gap-1", className)}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        const button = (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={Boolean(tab.disabled)}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-xs transition-colors duration-150",
              selected
                ? "border-primary-700 font-semibold text-ink-900"
                : "border-transparent font-medium text-ink-600 hover:text-ink-900",
              tab.disabled && "cursor-not-allowed text-ink-400 hover:text-ink-400",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined ? (
              <span className="tnum font-medium text-ink-600">{tab.count}</span>
            ) : null}
          </button>
        );
        return tab.disabled ? (
          <Tip key={tab.value} label={tab.disabled} side="bottom">
            {button}
          </Tip>
        ) : (
          button
        );
      })}
    </div>
  );
}

export function Card({
  children,
  className,
  ...props
}: ComponentProps<"section"> & { children: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-line-200 bg-surface-0", className)} {...props}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("font-semibold text-[15px] text-ink-900 leading-5", className)}>
      {children}
    </h2>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <h1 className="font-semibold text-[22px] text-ink-900 leading-7">{title}</h1>
        {description ? (
          <p className="mt-1 text-[13px] text-ink-600 leading-[18px]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}

// Wynik ryzyka: pasek 72 × 4 line-200, wypełnienie risk-700 (wysokie) albo ink-500 (średnie),
// kreska progu ink-900; liczba wyrównana do prawej i słowo (R2, R12, R14).
export function ScoreBar({
  score,
  flag,
  high,
  className,
}: {
  score: number;
  flag: number;
  high: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative block h-1 w-[72px] rounded-full bg-line-200", className)}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          high ? "bg-risk-700" : "bg-ink-500",
        )}
        style={{ width: `${Math.round(score * 100)}%` }}
      />
      <span
        className="absolute -top-1 h-3 w-px bg-ink-900"
        style={{ left: `${Math.round(flag * 100)}%` }}
      />
    </span>
  );
}

export function ScoreCell({
  score,
  flag,
  alert,
  confidence = false,
}: {
  score: number;
  flag: number;
  alert: number;
  // Moduł 1: wynik to pewność, że materiał jest reklamą, nie ryzyko (R18): bez koloru i bez „wysokie”.
  confidence?: boolean;
}) {
  const high = !confidence && score >= alert;
  const label = confidence
    ? `Pewność ${fmtScore(score)}, że to reklama firmy inwestycyjnej przez osobę trzecią. Próg ${fmtScore(flag)}.`
    : `Wynik ${fmtScore(score)}: ${high ? "wysoki, powyżej progu alertu" : "średni, powyżej progu flagi"} ${fmtScore(high ? alert : flag)}.`;
  return (
    <Tip label={label}>
      <span className="inline-flex items-center gap-3">
        <ScoreBar score={score} flag={flag} high={high} />
        <span
          className={cn(
            "tnum w-9 text-right font-semibold text-sm",
            high ? "text-risk-700" : "text-ink-900",
          )}
        >
          {fmtScore(score)}
        </span>
        <span className={cn("w-14 text-[13px]", high ? "text-risk-700" : "text-ink-600")}>
          {confidence ? "pewność" : high ? "wysokie" : "średnie"}
        </span>
      </span>
    </Tip>
  );
}

export function EmptyState({
  illustration,
  title,
  children,
}: {
  illustration: IllustrationName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Illustration name={illustration} size={48} />
      <p className="font-semibold text-[15px] text-ink-900">{title}</p>
      {children ? <div className="max-w-md text-[13px] text-ink-600">{children}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-md bg-surface-hover", className)} />;
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p className="rounded-md border border-line-300 bg-surface-1 px-3 py-2 text-[13px] text-ink-700">
      Nie udało się pobrać danych: {error instanceof Error ? error.message : "nieznany błąd"}.
    </p>
  );
}

// Awatar: 20 px, inicjały 9/600, tło line-200, zawsze obok imienia (R16).
export function Avatar({ reviewer, size = 20 }: { reviewer: Reviewer; size?: number }) {
  return (
    <Tip label={reviewer.role ? `${reviewer.name} · ${reviewer.role}` : reviewer.name}>
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-line-200 font-semibold text-[9px] text-ink-700"
        style={{ width: size, height: size }}
      >
        {initials(reviewer.name)}
      </span>
    </Tip>
  );
}

// Glif statusu z tooltipem: status, autor i czas (decyzja z 22.11, R6, R14, R16).
export function StatusTip({
  review,
}: {
  review: { status: UiStatus; reviewed_by?: Reviewer | null; reviewed_at?: string | null };
}) {
  return (
    <Tip label={reviewText(review)}>
      <StatusGlyph status={review.status} title={reviewText(review)} />
    </Tip>
  );
}
