import type { AnalysisModule, Platform } from "@app/db";
import type { Reviewer, UiStatus } from "./contract-ui";

// Teksty i formaty wspólne dla ekranów. Liczby po polsku: przecinek dziesiętny („0,84”).

export function fmtScore(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function fmtSigned(value: number, digits = 0): string {
  const abs = Math.abs(value).toFixed(digits).replace(".", ",");
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

export const MODULE_SHORT: Record<AnalysisModule, string> = {
  finfluencer: "M1",
  risk_disclosure: "M2",
  unauthorized_advisory: "M3",
};

export const MODULE_NUMBER: Record<AnalysisModule, number> = {
  finfluencer: 1,
  risk_disclosure: 2,
  unauthorized_advisory: 3,
};

export const MODULE_TITLE: Record<AnalysisModule, string> = {
  finfluencer: "Reklamy firm inwestycyjnych publikowane przez osoby trzecie",
  risk_disclosure: "Materiały firm bez wyraźnej informacji o ryzyku",
  unauthorized_advisory: "Doradztwo bez zezwolenia KNF",
};

export const MODULE_BY_NUMBER: Record<string, AnalysisModule> = {
  "1": "finfluencer",
  "2": "risk_disclosure",
  "3": "unauthorized_advisory",
};

export const STATUS_LABEL: Record<UiStatus, string> = {
  new: "Nowy",
  in_review: "W trakcie",
  postponed: "Odłożony",
  confirmed: "Potwierdzony",
  dismissed: "Fałszywy alarm",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: "WWW",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  telegram: "Telegram",
};

// Platformy zbierane w tej wersji (YouTube i strony WWW). Pozostałe zostają w enumie bazy.
export const ACTIVE_PLATFORMS = ["youtube", "web"] as const satisfies readonly Platform[];

// Etykiety z wyjścia modelu i z modułu 1 (docs/KONTRAKT.md §2).
const LABELS: Record<string, string> = {
  reklama: "reklama przez osobę trzecią",
  wzmianka: "wzmianka o firmie",
  material_firmy: "materiał firmy",
  brak_firmy: "bez rozpoznanej firmy",
  inny_jezyk: "inny język",
  blad_analizy: "błąd analizy",
  potencjalne_doradztwo: "potencjalne doradztwo",
  usluga_dozwolona: "usługa dozwolona (zezwolenie KNF)",
  brak_przeslanek: "brak przesłanek doradztwa",
  naruszenie: "naruszenie",
};

export function labelText(label: string): string {
  return LABELS[label] ?? label.replaceAll("_", " ");
}

const time = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});
const dayMonth = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Warsaw",
});
const longDate = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

export function fmtTime(iso: string): string {
  return time.format(new Date(iso));
}

export function fmtDayMonth(iso: string): string {
  return dayMonth.format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  return `${fmtDayMonth(iso)} ${fmtTime(iso)}`;
}

export function fmtToday(now = new Date()): string {
  const text = longDate.format(now).replace(",", "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayKey(date: Date): string {
  return dayMonth.format(date);
}

// „przed chwilą”, „dziś 08:03”, „wczoraj 21:14”, „20.11 19:40”.
export function fmtRelative(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 5 * 60_000) return "przed chwilą";
  if (dayKey(date) === dayKey(now)) return `dziś ${fmtTime(iso)}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(date) === dayKey(yesterday)) return `wczoraj ${fmtTime(iso)}`;
  return fmtDateTime(iso);
}

export function fmtDayHeader(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (dayKey(date) === dayKey(now)) return `Dziś, ${fmtDayMonth(iso)}`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(date) === dayKey(yesterday)) return `Wczoraj, ${fmtDayMonth(iso)}`;
  return fmtDayMonth(iso);
}

export function daysAgoIso(days: number, now = new Date()): string {
  const date = new Date(now.getTime() - days * 86_400_000);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

// „Marta K.” z „Marta Kowalska”; krótsze imiona zostają bez zmian.
export function shortName(reviewer: Reviewer): string {
  const [first, last] = reviewer.name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : reviewer.name;
}

// Tekst decyzji do tooltipa i metadanych: „W trakcie, Marta K. od 09:02”.
export function reviewText(review: {
  status: UiStatus;
  reviewed_by?: Reviewer | null;
  reviewed_at?: string | null;
}): string {
  const label = STATUS_LABEL[review.status];
  if (!review.reviewed_by && !review.reviewed_at) return label;
  const who = review.reviewed_by ? shortName(review.reviewed_by) : null;
  const when = review.reviewed_at ? fmtDateTime(review.reviewed_at) : null;
  if (review.status === "in_review") {
    return [label, [who, when ? `od ${when}` : null].filter(Boolean).join(" ")].join(", ");
  }
  return [label, [who, when].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}
