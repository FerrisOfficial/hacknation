import type { Platform } from "@app/db";
import { z } from "zod";
import type { Evidence } from "@/lib/incidents/contract";

// Dowód do flagi (docs/KONTRAKT.md §3): model zwraca tylko cytat, a backend szuka go w
// `materials.text` (pozycje `start`/`end` w jednostkach JS-owego stringa — UI podświetla
// `text.slice(start, end)`), w napisach filmu (`timestamp_s`) i buduje `link`.

export type Span = { start: number; end: number };

// Znaki, które model lubi zamieniać: cudzysłowy drukarskie, półpauzy, twarde spacje.
const CHAR_EQUIVALENTS: Record<string, string> = {
  "„": '"',
  "”": '"',
  "“": '"',
  "«": '"',
  "»": '"',
  "‘": "'",
  "’": "'",
  "‚": "'",
  "–": "-",
  "—": "-",
  "‑": "-",
};

// Tekst do porównań: małe litery, ujednolicone cudzysłowy/myślniki, ciągi białych znaków jako
// jedna spacja. `map[i]` = indeks w oryginale znaku `normalized[i]`.
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? "";
    if (/\s/.test(char)) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      map.push(i - 1);
      pendingSpace = false;
    }
    const lower = char.toLowerCase();
    normalized += CHAR_EQUIVALENTS[char] ?? (lower.length === 1 ? lower : char);
    map.push(i);
  }
  return { normalized, map };
}

// Cytat od modelu bywa ujęty w cudzysłów albo ucięty wielokropkiem — to nie jest część tekstu.
function cleanQuote(quote: string): string {
  return quote
    .normalize("NFC")
    .trim()
    .replace(/^["'„“”«»‚‘’]+|["'„“”«»‚‘’]+$/g, "")
    .replace(/(\.\.\.|…)+$/, "")
    .replace(/^(\.\.\.|…)+/, "")
    .trim();
}

// Pozycja cytatu w tekście: najpierw dosłownie, potem bez różnic w wielkości liter, białych
// znakach, cudzysłowach i myślnikach. null = cytatu nie ma w tekście (model sparafrazował).
export function findQuote(text: string, quote: string): Span | null {
  const cleaned = cleanQuote(quote);
  if (!cleaned) return null;
  const exact = text.indexOf(cleaned);
  if (exact >= 0) return { start: exact, end: exact + cleaned.length };

  const needle = normalizeWithMap(cleaned).normalized;
  if (!needle) return null;
  const haystack = normalizeWithMap(text);
  const at = haystack.normalized.indexOf(needle);
  if (at < 0) return null;
  const start = haystack.map[at];
  const last = haystack.map[at + needle.length - 1];
  if (start === undefined || last === undefined) return null;
  return { start, end: last + 1 };
}

// Napisy filmu z `materials.metadata.transcript` (kolektor YouTube).
const transcriptSchema = z.object({
  transcript: z.object({
    segments: z.array(z.object({ start: z.number().min(0), text: z.string() })),
  }),
});

// Sekunda filmu, w której pada cytat. null, gdy materiał nie ma napisów albo cytat pochodzi
// z tytułu lub opisu.
export function transcriptTimestamp(
  metadata: Record<string, unknown>,
  quote: string,
): number | null {
  const parsed = transcriptSchema.safeParse(metadata);
  if (!parsed.success) return null;
  const segments = parsed.data.transcript.segments;
  // Ten sam sposób łączenia co w services/ml (napisy po spacji), z zapamiętanym początkiem
  // każdego segmentu w połączonym tekście.
  const offsets: number[] = [];
  let joined = "";
  for (const segment of segments) {
    if (joined) joined += " ";
    offsets.push(joined.length);
    joined += segment.text;
  }
  const span = findQuote(joined, quote);
  if (!span) return null;
  let index = 0;
  for (let i = 0; i < offsets.length; i++) {
    if ((offsets[i] ?? 0) <= span.start) index = i;
  }
  const segment = segments[index];
  return segment ? Math.floor(segment.start) : null;
}

// `link` z §3: WWW — Text Fragment (przeglądarka przewija i podświetla cytat), YouTube — `&t=`.
export function evidenceLink(
  url: string,
  platform: Platform,
  quote: string,
  timestampS: number | null,
): string {
  if (platform === "youtube") {
    if (timestampS === null) return url;
    return `${url}${url.includes("?") ? "&" : "?"}t=${timestampS}s`;
  }
  // Text Fragment nie dopasuje znaku nowej linii — w DOM akapity i tak są osobnymi blokami.
  const fragment = encodeURIComponent(quote.replace(/\s+/g, " ").trim()).replace(/-/g, "%2D");
  return `${url}${url.includes("#") ? "" : "#"}:~:text=${fragment}`;
}

export function buildEvidence(
  material: { url: string; platform: Platform; text: string; metadata: Record<string, unknown> },
  quote: string | null,
): Evidence | null {
  if (!quote) return null;
  const span = findQuote(material.text, quote);
  if (!span) return null;
  const found = material.text.slice(span.start, span.end);
  const timestampS =
    material.platform === "youtube" ? transcriptTimestamp(material.metadata, found) : null;
  return {
    quote: found,
    start: span.start,
    end: span.end,
    timestamp_s: timestampS,
    link: evidenceLink(material.url, material.platform, found, timestampS),
  };
}
