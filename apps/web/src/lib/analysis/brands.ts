import type { KnfEntity } from "./entity";

// Marki firm inwestycyjnych obecnych na polskim rynku (moduł 1). Lista tylko podpowiada, czego
// szukać — czy marka to firma z rejestru usług inwestycyjnych, rozstrzyga zawsze odpowiedź KNF
// (`matchBrandEntity`). Służy do dwóch rzeczy:
// 1. frazy wyszukiwania YouTube („{marka} kod”…) — `m1SearchQueries`,
// 2. wzmianka marki w tekście bez linku („polecam XTB”) — `mentionedBrands`.

export type Brand = {
  id: string;
  name: string;
  // Zapisy marki w tekście (bez rozróżniania wielkości liter, całe słowa).
  aliases: string[];
  // Fraza do wyszukiwarki KNF (nazwa albo domena, którą KNF zna).
  knfQuery: string;
  // Początki nazw podmiotów w KNF (małe litery, bez znaków spoza liter i cyfr).
  knfNames: string[];
};

export const BRANDS: readonly Brand[] = [
  brand("xtb", "XTB", ["XTB", "X-Trade Brokers"], "xtb.com", ["xtb", "xtrade"]),
  brand("etoro", "eToro", ["eToro"], "etoro.com", ["etoro"]),
  brand("trading212", "Trading 212", ["Trading 212", "Trading212"], "Trading 212", ["trading212"]),
  brand("freedom24", "Freedom24", ["Freedom24", "Freedom 24"], "Freedom Finance", [
    "freedomfinance",
  ]),
  brand("ibkr", "Interactive Brokers", ["Interactive Brokers", "IBKR"], "Interactive Brokers", [
    "interactivebrokers",
  ]),
  brand("exante", "Exante", ["Exante"], "Exante", ["exante", "xntltd"]),
  brand("plus500", "Plus500", ["Plus500"], "Plus500", ["plus500"]),
  brand("admirals", "Admirals", ["Admirals", "Admiral Markets"], "Admiral", ["admiral"]),
  brand("capitalcom", "Capital.com", ["Capital.com"], "Capital Com", ["capitalcom"]),
  brand("degiro", "DEGIRO", ["DEGIRO"], "flatexDEGIRO", ["flatexdegiro", "degiro"]),
  brand("lightyear", "Lightyear", ["Lightyear"], "Lightyear", ["lightyear"]),
  brand("scalable", "Scalable Capital", ["Scalable Capital"], "Scalable Capital", ["scalable"]),
  brand("revolut", "Revolut", ["Revolut"], "Revolut Securities", ["revolutsecurities"]),
  brand("lynx", "LYNX", ["LYNX"], "LYNX", ["lynx"]),
  brand("oanda", "OANDA", ["OANDA"], "OANDA", ["oanda"]),
  brand("bossa", "Bossa", ["bossa.pl", "DM BOŚ", "Dom Maklerski BOŚ"], "Dom Maklerski BOŚ", [
    "dommaklerskibos",
  ]),
];

function brand(
  id: string,
  name: string,
  aliases: string[],
  knfQuery: string,
  knfNames: string[],
): Brand {
  return { id, name, aliases, knfQuery, knfNames };
}

// Szablony fraz dla każdej marki — reklamy i polecenia, także te bez etykiety płatnej promocji.
export const M1_QUERY_TEMPLATES = [
  "{brand} kod",
  "{brand} polecam",
  "{brand} jak założyć konto",
  "{brand} recenzja",
] as const;

export function m1SearchQueries(brands: readonly Brand[] = BRANDS): string[] {
  return brands.flatMap((b) => M1_QUERY_TEMPLATES.map((t) => t.replace("{brand}", b.name)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALIAS_PATTERNS = BRANDS.map((b) => ({
  brand: b,
  pattern: new RegExp(
    `(?<![\\p{L}\\d])(?:${b.aliases.map(escapeRegExp).join("|")})(?![\\p{L}\\d])`,
    "giu",
  ),
}));

export type BrandMention = { brand: Brand; at: number; count: number };

// Marki wymienione w tekście, od najczęściej wymienianej (przy remisie — od pierwszej wzmianki).
export function mentionedBrands(text: string): BrandMention[] {
  return ALIAS_PATTERNS.flatMap(({ brand: b, pattern }) => {
    const matches = [...text.matchAll(pattern)];
    const first = matches[0];
    return first ? [{ brand: b, at: first.index, count: matches.length }] : [];
  }).sort((a, b) => b.count - a.count || a.at - b.at);
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\d]/gu, "");
}

// Podmiot z rejestru usług inwestycyjnych, który odpowiada marce (wynik wyszukiwarki KNF).
export function matchBrandEntity(entities: readonly KnfEntity[], b: Brand): KnfEntity | null {
  return (
    entities.find(
      (entity) =>
        entity.investment_register && b.knfNames.some((n) => nameKey(entity.name).startsWith(n)),
    ) ?? null
  );
}
