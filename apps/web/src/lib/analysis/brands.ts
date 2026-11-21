import { byRegisterRank, type KnfEntity, registrableDomain } from "./entity";

// Marki firm inwestycyjnych obecnych na polskim rynku (moduł 1). Lista tylko podpowiada, czego
// szukać — czy marka to firma z rejestru usług inwestycyjnych, rozstrzyga zawsze odpowiedź KNF
// (`matchBrandEntity`). Służy do trzech rzeczy:
// 1. frazy wyszukiwania YouTube („{marka} kod”…) — `m1SearchQueries`,
// 2. wzmianka marki w tekście bez linku („polecam XTB”) — `mentionedBrands`,
// 3. link do domeny marki (`brandOfDomain`) — wpis KNF po marce, także gdy KNF nie ma przy nim
//    domeny (biura maklerskie banków, notyfikacje) albo ma ją przy innej spółce z grupy
//    (xtb.com jest w KNF przy XTB Ltd, a polski klient ma umowę z XTB S.A.).

export type Brand = {
  id: string;
  name: string;
  // Zapisy marki w tekście (bez rozróżniania wielkości liter, całe słowa).
  aliases: string[];
  // Fraza do wyszukiwarki KNF (nazwa albo domena, którą KNF zna).
  knfQuery: string;
  // Początki nazw podmiotów w KNF (małe litery, bez znaków spoza liter i cyfr).
  knfNames: string[];
  // Domeny główne marki (`registrableDomain`).
  domains: string[];
  // Marka nie tylko od inwestycji (bank, Revolut): reklama dotyczy usług inwestycyjnych tylko
  // wtedy, gdy tekst mówi o inwestowaniu (`hasInvestmentContext`) — inaczej to np. konto osobiste.
  needsInvestmentContext: boolean;
  // Szablony fraz wyszukiwania YouTube (`{brand}` = `name`).
  queries: readonly string[];
  // Broker, którego KNF ma tylko w notyfikacjach zagranicznych instytucji kredytowych (DEGIRO).
  // Instytucja kredytowa z działalnością maklerską to też zagraniczna firma inwestycyjna
  // (docs/materialy-uknf/firmy-inwestycyjne.md), ale rejestr tego nie rozróżnia — dla marki wiemy.
  foreignCreditInstitution: boolean;
};

// Szablony fraz dla marki — reklamy i polecenia, także te bez etykiety płatnej promocji.
export const M1_QUERY_TEMPLATES = [
  "{brand} kod",
  "{brand} polecam",
  "{brand} jak założyć konto",
  "{brand} recenzja",
] as const;

// Banki: tylko oferta maklerska — „{bank} kod” to zwykle reklama konta osobistego.
const BANK_QUERY_TEMPLATES = ["{brand} rachunek maklerski"] as const;

type BrandOptions = {
  needsInvestmentContext?: boolean;
  queries?: readonly string[];
  foreignCreditInstitution?: boolean;
};

function brand(
  id: string,
  name: string,
  aliases: string[],
  knfQuery: string,
  knfNames: string[],
  domains: string[],
  options: BrandOptions = {},
): Brand {
  return {
    id,
    name,
    aliases,
    knfQuery,
    knfNames,
    domains,
    needsInvestmentContext: options.needsInvestmentContext ?? false,
    queries: options.queries ?? M1_QUERY_TEMPLATES,
    foreignCreditInstitution: options.foreignCreditInstitution ?? false,
  };
}

// Bank prowadzący działalność maklerską: w KNF osobny wpis „Firmy inwestycyjne - Banki
// prowadzące działalność maklerską” bez domeny, o nazwie „{bank} S.A. Biuro Maklerskie …” —
// zapytanie „Biuro Maklerskie” zwraca wszystkie naraz. Domeny z wpisu banku w KNF.
function bank(
  id: string,
  name: string,
  aliases: string[],
  knfNames: string[],
  domains: string[],
): Brand {
  return brand(id, name, aliases, "Biuro Maklerskie", knfNames, domains, {
    needsInvestmentContext: true,
    queries: BANK_QUERY_TEMPLATES,
  });
}

export const BRANDS: readonly Brand[] = [
  brand("xtb", "XTB", ["XTB", "X-Trade Brokers"], "XTB", ["xtb", "xtrade"], ["xtb.com"]),
  brand("etoro", "eToro", ["eToro"], "etoro.com", ["etoro"], ["etoro.com"]),
  brand(
    "trading212",
    "Trading 212",
    ["Trading 212", "Trading212"],
    "Trading 212",
    ["trading212"],
    ["trading212.com"],
  ),
  brand(
    "freedom24",
    "Freedom24",
    ["Freedom24", "Freedom 24"],
    "Freedom Finance",
    ["freedomfinance"],
    ["freedom24.com"],
  ),
  brand(
    "ibkr",
    "Interactive Brokers",
    ["Interactive Brokers", "IBKR"],
    "Interactive Brokers",
    ["interactivebrokers"],
    ["interactivebrokers.com", "interactivebrokers.ie", "interactivebrokers.co.uk", "ibkr.com"],
  ),
  brand("exante", "Exante", ["Exante"], "Exante", ["exante", "xntltd"], ["exante.eu"]),
  brand("plus500", "Plus500", ["Plus500"], "Plus500", ["plus500"], ["plus500.com"]),
  brand(
    "admirals",
    "Admirals",
    ["Admirals", "Admiral Markets"],
    "Admiral",
    ["admiral"],
    ["admirals.com", "admiralmarkets.com"],
  ),
  brand(
    "capitalcom",
    "Capital.com",
    ["Capital.com"],
    "Capital Com",
    ["capitalcom"],
    ["capital.com"],
  ),
  brand(
    "degiro",
    "DEGIRO",
    ["DEGIRO"],
    "flatexDEGIRO",
    ["flatexdegiro", "degiro"],
    ["degiro.pl", "degiro.com"],
    { foreignCreditInstitution: true },
  ),
  brand("lightyear", "Lightyear", ["Lightyear"], "Lightyear", ["lightyear"], ["lightyear.com"]),
  brand(
    "scalable",
    "Scalable Capital",
    ["Scalable Capital"],
    "Scalable Capital",
    ["scalable"],
    ["scalable.capital"],
  ),
  // Polecenia Revoluta to zwykle konto, nie inwestowanie — stąd kontekst i frazy o akcjach.
  brand(
    "revolut",
    "Revolut",
    ["Revolut"],
    "Revolut Securities",
    ["revolutsecurities"],
    ["revolut.com"],
    { needsInvestmentContext: true, queries: ["{brand} akcje", "{brand} inwestowanie"] },
  ),
  brand("lynx", "LYNX", ["LYNX"], "LYNX", ["lynx"], ["lynxbroker.pl"]),
  brand("saxo", "Saxo", ["Saxo", "Saxo Bank"], "Saxo", ["saxobank"], ["home.saxo"], {
    foreignCreditInstitution: true,
  }),
  // W Polsce z oddziałem; w KNF jako zagraniczna instytucja kredytowa.
  brand(
    "traderepublic",
    "Trade Republic",
    ["Trade Republic"],
    "Trade Republic",
    ["traderepublic"],
    ["traderepublic.com"],
    { foreignCreditInstitution: true },
  ),
  brand("finax", "Finax", ["Finax"], "Finax", ["finax"], ["finax.eu"]),
  // Bez fraz wyszukiwania — tylko rozpoznanie linku i wzmianki. Conotoxia ma w KNF domenę
  // kantoru cinkciarz.pl, więc liczy się tylko w tekście o inwestowaniu (forex, CFD).
  brand(
    "conotoxia",
    "Conotoxia",
    ["Conotoxia", "Cinkciarz"],
    "Conotoxia",
    ["conotoxia"],
    ["conotoxia.com", "cinkciarz.pl"],
    { needsInvestmentContext: true, queries: [] },
  ),
  brand(
    "noble",
    "Noble Securities",
    ["Noble Securities"],
    "Noble Securities",
    ["noblesecurities"],
    ["noblesecurities.pl"],
    { queries: [] },
  ),
  brand("oanda", "OANDA", ["OANDA"], "OANDA", ["oanda"], ["oanda.com"]),
  brand(
    "bossa",
    "Bossa",
    ["bossa.pl", "DM BOŚ", "Dom Maklerski BOŚ"],
    "Dom Maklerski Banku Ochrony Środowiska",
    ["dommaklerskibankuochronyśrodowiska"],
    ["bossa.pl"],
  ),
  bank("mbank", "mBank", ["mBank", "mBanku", "mBankiem", "eMakler"], ["mbank"], ["mbank.pl"]),
  bank(
    "pkobp",
    "PKO BP",
    ["PKO BP", "PKO Bank Polski", "PKO Banku Polskiego"],
    ["powszechnakasaoszczędności"],
    ["pkobp.pl", "ipko.pl"],
  ),
  bank("pekao", "Pekao", ["Pekao"], ["bankpekao", "bankpolskakasaopieki"], ["pekao.com.pl"]),
  bank("ing", "ING", ["ING"], ["ingbank"], ["ing.pl", "ingbank.pl"]),
  bank(
    "millennium",
    "Bank Millennium",
    ["Bank Millennium", "Banku Millennium", "Millennium Bank"],
    ["bankmillennium"],
    ["bankmillennium.pl"],
  ),
  bank("alior", "Alior Bank", ["Alior"], ["aliorbank"], ["aliorbank.pl"]),
  bank("bnpparibas", "BNP Paribas", ["BNP Paribas"], ["bnpparibas"], ["bnpparibas.pl"]),
  // Dawniej Santander Bank Polska.
  bank("erste", "Erste", ["Erste", "Santander"], ["erstebank"], ["erste.pl", "santander.pl"]),
];

export function m1SearchQueries(brands: readonly Brand[] = BRANDS): string[] {
  return brands.flatMap((b) => b.queries.map((t) => t.replace("{brand}", b.name)));
}

// Marka, do której należy domena z linku („akcje.xtb.com” → XTB). null dla nieznanych.
export function brandOfDomain(domain: string): Brand | null {
  const base = registrableDomain(domain);
  return BRANDS.find((b) => b.domains.includes(base)) ?? null;
}

// Słowa, po których tekst mówi o usługach inwestycyjnych, a nie o koncie osobistym czy karcie.
// Bez „akcja” — „akcja promocyjna” to typowa reklama konta.
const INVESTMENT_CONTEXT =
  /(?<!\p{L})(e?makler\p{L}*|giełd\p{L}*|inwest\p{L}*|etf\p{L}*|ike|ikze|obligacj\p{L}*|dywidend\p{L}*|notowa\p{L}*|papier\p{L}* wartościow\p{L}*|cfd)(?!\p{L})/iu;

export function hasInvestmentContext(text: string): boolean {
  return INVESTMENT_CONTEXT.test(text);
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

// Pozycje wszystkich wzmianek marki w tekście (całe słowa, bez wielkości liter).
export function brandPositions(text: string, b: Brand): number[] {
  const pattern = ALIAS_PATTERNS.find((p) => p.brand.id === b.id)?.pattern;
  return pattern ? [...text.matchAll(pattern)].map((match) => match.index) : [];
}

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

const FOREIGN_CREDIT_INSTITUTIONS = /notyfikacje zagranicznych instytucji kredytowych/i;

// Podmiot z rejestru usług inwestycyjnych, który odpowiada marce (wynik wyszukiwarki KNF).
// Kilka wpisów marki (XTB S.A. i XTB Ltd) — polski rejestr firm inwestycyjnych pierwszy.
export function matchBrandEntity(entities: readonly KnfEntity[], b: Brand): KnfEntity | null {
  const candidates = entities.flatMap((entity) => {
    if (!b.knfNames.some((n) => nameKey(entity.name).startsWith(n))) return [];
    if (entity.investment_register) return [entity];
    const broker =
      b.foreignCreditInstitution &&
      !entity.deleted &&
      FOREIGN_CREDIT_INSTITUTIONS.test(entity.register_name);
    return broker ? [{ ...entity, investment_register: true }] : [];
  });
  return [...candidates].sort(byRegisterRank)[0] ?? null;
}
