import type { Material } from "@app/db";
import { z } from "zod";
import type { Flag, IncidentDetails, IncidentEntity } from "@/lib/incidents/contract";
import {
  type Brand,
  type BrandMention,
  brandOfDomain,
  brandPositions,
  hasInvestmentContext,
  matchBrandEntity,
  mentionedBrands,
} from "./brands";
import type { AnalysisResultInput } from "./contract";
import {
  domainMatches,
  entityNip,
  type KnfEntity,
  type KnfWarning,
  matchBrand,
  matchEntity,
  matchWarning,
  normalizeDomain,
  type OutboundLink,
  outboundLinks,
  registrableDomain,
} from "./entity";
import { buildEvidence, evidenceLink } from "./evidence";
import { findRule } from "./rules";

// Moduł 1 — finfluencerzy i podmioty trzecie — bez modelu AI (docs/ZADANIE.md: moduł ma znaleźć
// reklamę firmy inwestycyjnej publikowaną przez kogoś innego, nie oceniać jej treści).
// Czysta funkcja na sygnałach, które zbierają kolektory:
// 1. bramki: materiał po polsku; link z materiału prowadzi do firmy z rejestru KNF (albo z listy
//    ostrzeżeń) albo tekst wymienia markę, którą KNF potwierdza; materiał nie pochodzi od tej
//    firmy (własna strona / własny kanał to przypadek dla M2);
// 2. score = noisy-OR wag sygnałów reklamy: etykieta płatnej promocji, kod polecający,
//    link afiliacyjny albo bezpośredni do firmy (albo sama nazwa w tekście), frazy reklamowe.

export const FINFLUENCER_MODEL = "rules/m1";
export const AD_LABEL_FROM = 0.5;

export const SIGNAL_WEIGHTS = {
  paid_promotion: 0.6,
  promo_code: 0.5,
  affiliate_link: 0.5,
  direct_link: 0.3,
  ad_phrase: 0.3,
  // Nazwa firmy w tekście bez linku do niej („polecam XTB”) — słabsza od linku.
  brand_mention: 0.2,
} as const;

export type SignalKind = keyof typeof SIGNAL_WEIGHTS;
export type Signal = { kind: SignalKind; detail: string; at: number | null };

export type FinfluencerMaterial = Pick<
  Material,
  "url" | "platform" | "author" | "title" | "text" | "metadata" | "language"
>;

// Wyniki KNF per domena główna z linków (`registrableDomain`): null = wyszukiwarka nie odpowiedziała.
// `brands`: wyniki KNF dla marek wymienionych w tekście (`mentionedBrands`) i marek domen z linków
// (`brandOfDomain`), po `Brand.id`.
export type FirmLookup = {
  searches: { domain: string; entities: readonly KnfEntity[] | null }[];
  warnings: readonly KnfWarning[] | null;
  brands?: { id: string; entities: readonly KnfEntity[] | null }[];
};

// Moduł 1 dotyczy polskiego rynku: reklam po polsku (także zagranicznych firm).
const PL_WORDS = new Set([
  "i",
  "w",
  "na",
  "nie",
  "się",
  "to",
  "jest",
  "że",
  "z",
  "do",
  "jak",
  "co",
  "ale",
  "po",
  "za",
  "od",
  "dla",
  "czy",
  "tak",
  "jestem",
  "oraz",
  "który",
  "które",
  "są",
]);
const EN_WORDS = new Set([
  "the",
  "and",
  "to",
  "of",
  "is",
  "you",
  "in",
  "that",
  "it",
  "for",
  "this",
  "with",
  "are",
  "on",
  "your",
  "how",
  "what",
  "be",
]);
// Czeski i słowacki mają większość słów z `PL_WORDS` (na, to, jak, co, ale, za, po, do), a kanały
// czeskie i słowackie też linkują do XTB — rozróżniają je litery i słowa, których polski nie ma.
const CS_SK_WORDS = new Set([
  "v",
  "ve",
  "je",
  "se",
  "si",
  "pro",
  "jsem",
  "jsme",
  "jste",
  "jsou",
  "není",
  "také",
  "když",
  "jako",
  "který",
  "která",
  "které",
  "nebo",
  "protože",
  "jen",
  "už",
  "být",
  "sa",
  "som",
  "ako",
  "alebo",
  "pre",
  "ktorý",
  "aj",
]);
const PL_LETTERS = /[ąćęłńśźż]/gu;
const CS_SK_LETTERS = /[ěřůťďňľĺŕô]/gu;

export function isPolish(material: Pick<FinfluencerMaterial, "language" | "text">): boolean {
  const language = material.language?.toLowerCase();
  if (language) return language.startsWith("pl");
  const words =
    material.text
      .toLowerCase()
      .match(/\p{L}+/gu)
      ?.slice(0, 600) ?? [];
  const pl = words.filter((w) => PL_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  const csSk = words.filter((w) => CS_SK_WORDS.has(w)).length;
  const sample = words.join(" ");
  const plLetters = sample.match(PL_LETTERS)?.length ?? 0;
  const csSkLetters = sample.match(CS_SK_LETTERS)?.length ?? 0;
  return pl >= 3 && pl >= en && pl > csSk && csSkLetters <= plLetters;
}

// Frazy, którymi twórcy zapowiadają współpracę i zachęcają do założenia konta.
// `(?<!\p{L})` zamiast `\b` — `\b` w JS nie zna polskich liter.
const AD_PHRASES =
  /(?<!\p{L})(link\p{L}* w opisie|link\p{L}* (?:partnersk|afiliacyjn|polecając|referencyjn)\p{L}*|z (?:mojego|tego) linku|z moim kodem|kod\p{L}* (?:promocyjn|polecając|rabatow|zniżkow)\p{L}*|bonus\p{L}* na start|otwórz (?:konto|rachunek)|załóż (?:konto|rachunek)|zarejestruj się|współprac\p{L}* (?:reklamow|płatn)\p{L}*|materiał\p{L}* sponsorowan\p{L}*|(?:partner|sponsor)\p{L}* (?:odcinka|filmu|materiału)|darmow\p{L}* akcj\p{L}*|#(?:ad|reklama|wspolpraca|współpraca|sponsored)(?!\p{L}))/iu;

const AD_PHRASES_ALL = new RegExp(AD_PHRASES.source, "giu");

// Kandydat na kod z tekstu („kod: KANAL50”, „kodem promocyjnym XTB24”) — dla stron WWW, filmy
// mają `promo_codes` z kolektora. Słowo między „kod” a kodem tylko małymi literami, a przed kodem
// zawsze odstęp albo dwukropek — inaczej regex tnie kod („DETERMINACJA” → „ACJA”).
const CODE_CANDIDATES =
  /(?<!\p{L})[Kk]od\p{L}*(?:\s+(\p{Ll}+))?(\s*[:\-–]\s*|\s+)["„]?([A-Z0-9][A-Z0-9_-]{3,19})(?![\p{L}\d])/gu;

// Słowo przy „kod”, które mówi, że to kod polecający, a nie np. „kod ISIN”.
const REFERRAL_WORD = /^(promocyjn|polecając|rabatow|zniżkow|partnersk|afiliacyjn|referencyjn)/u;

// Skróty, które stoją po „kod” w tekstach o inwestowaniu, a kodem polecającym nie są.
const NOT_CODES = new Set([
  "ISIN",
  "ETF",
  "ETFS",
  "IKE",
  "IKZE",
  "OIPE",
  "PIT",
  "NIP",
  "KRS",
  "REGON",
  "PESEL",
  "IBAN",
  "SWIFT",
  "BLIK",
  "SMS",
  "PIN",
  "CVV",
  "OTP",
  "VAT",
  "HTML",
  "LEI",
  "CFI",
  "TICKER",
]);

// Kod polecający z tekstu: po słowie typu „promocyjny”, po dwukropku albo z cyfrą w środku.
export function extractTextCode(text: string): string | null {
  for (const match of text.matchAll(CODE_CANDIDATES)) {
    const [, word, separator = "", code = ""] = match;
    if (NOT_CODES.has(code)) continue;
    if ((word && REFERRAL_WORD.test(word)) || separator.includes(":") || /\d/.test(code)) {
      return code;
    }
  }
  return null;
}

const videoMetadataSchema = z.object({
  paid_promotion: z.boolean().optional().catch(undefined),
  promo_codes: z.array(z.string()).optional().catch(undefined),
});

// Formy prawne i słowa ogólne, bez których porównujemy nazwę kanału z nazwą firmy.
const LEGAL_WORDS =
  /(?<!\p{L})(s\.?\s?a\.?|sp\.?\s?z\s?o\.?\s?o\.?|sp\.?\s?k\.?|ltd\.?|limited|plc|gmbh|ag|n\.?v\.?|b\.?v\.?|inc\.?|dom maklerski|biuro maklerskie|towarzystwo funduszy inwestycyjnych|tfi|bank|polska|poland|oddział w polsce)(?!\p{L})/giu;

function nameCore(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_WORDS, " ")
    .replace(/[^\p{L}\d]+/gu, "");
}

// Kanał firmy (np. „XTB” dla „XTB S.A.”) — wtedy to jej własny materiał, nie podmiot trzeci.
export function isOwnChannel(author: string | null, firmName: string): boolean {
  if (!author) return false;
  const a = nameCore(author);
  const f = nameCore(firmName);
  return a.length >= 3 && f.length >= 3 && (a.includes(f) || f.includes(a));
}

// Kanał pod marką („PKO Bank Polski”), gdy nazwa w KNF jest inna („Powszechna Kasa…”).
// Równość, nie zawieranie — „ING” jest w „Investing”.
export function isBrandChannel(author: string | null, brand: Brand | null): boolean {
  if (!author || !brand) return false;
  const a = nameCore(author);
  return a.length >= 2 && [brand.name, ...brand.aliases].some((alias) => nameCore(alias) === a);
}

type Firm = {
  // null = firma znaleziona po nazwie w tekście (`mention`), bez linku.
  link: OutboundLink | null;
  mention: BrandMention | null;
  // Marka ze słownika (`brands.ts`), jeśli firmę znaleziono przez nią albo przez jej domenę.
  brand: Brand | null;
  entity: KnfEntity | null;
  warning: KnfWarning | null;
};

// Kandydaci na reklamowaną firmę, od najpewniejszego: firmy z rejestru usług inwestycyjnych
// z linków (dla domeny znanej marki — wpis KNF po marce, potem po domenie), podmioty z listy
// ostrzeżeń KNF z linków (reklama podmiotu bez zezwolenia), marki wymienione w tekście, które
// KNF potwierdza jako firmy z rejestru. Każda firma raz. Marka nie tylko od inwestycji (bank,
// Revolut) liczy się tylko w tekście o inwestowaniu.
export function findFirmCandidates(
  material: Pick<FinfluencerMaterial, "url" | "metadata" | "text">,
  lookup: FirmLookup,
): Firm[] {
  const links = outboundLinks(material);
  const investing = hasInvestmentContext(material.text);
  const outOfScope = (brand: Brand | null) => brand?.needsInvestmentContext === true && !investing;
  const brandEntity = (brand: Brand) => {
    const search = lookup.brands?.find((b) => b.id === brand.id);
    return search?.entities ? matchBrandEntity(search.entities, brand) : null;
  };

  const firms: Firm[] = [];
  const seen = new Set<string>();
  const add = (firm: Firm) => {
    const keys = [
      firm.entity ? `e${firm.entity.id}` : null,
      firm.warning ? `w${firm.warning.number}:${firm.warning.entities}` : null,
      firm.brand ? `b${firm.brand.id}` : null,
    ].filter((key): key is string => key !== null);
    if (keys.some((key) => seen.has(key))) return;
    for (const key of keys) seen.add(key);
    firms.push(firm);
  };

  for (const link of links) {
    const brand = brandOfDomain(link.domain);
    if (outOfScope(brand)) continue;
    const byBrand = brand ? brandEntity(brand) : null;
    if (byBrand) {
      add({ link, mention: null, brand, entity: byBrand, warning: null });
      continue;
    }
    const base = registrableDomain(link.domain);
    const search = lookup.searches.find((s) => s.domain === base);
    const entity = search?.entities
      ? (matchEntity(search.entities, { domain: link.domain, nip: null }) ??
        matchBrand(search.entities, link.domain))
      : null;
    if (entity?.investment_register) add({ link, mention: null, brand, entity, warning: null });
  }
  for (const link of links) {
    const warning = lookup.warnings
      ? matchWarning(lookup.warnings, { domain: link.domain, nip: null })
      : null;
    if (warning) add({ link, mention: null, brand: null, entity: null, warning });
  }
  for (const mention of mentionedBrands(material.text)) {
    if (outOfScope(mention.brand)) continue;
    const entity = brandEntity(mention.brand);
    if (entity) add({ link: null, mention, brand: mention.brand, entity, warning: null });
  }
  return firms;
}

// Akapit (tekst między pustymi liniami) do tej długości to jeden blok opisu — np. blok sponsora
// z nazwą, linkiem i kodem. W dłuższym (napisy filmu, opis bez akapitów) — okno wokół wzmianki.
const BLOCK_MAX_CHARS = 600;
const NEAR_CHARS = 250;
const OFFER_LINK = /https?:\/\/|www\./i;
const SAME_LINE_CHARS = 400;

const transcriptSchema = z.object({
  transcript: z.object({ segments: z.array(z.object({ text: z.string() })).min(1) }),
});

// Gdzie w `materials.text` zaczynają się napisy filmu (kolektor dokleja je na końcu, segmenty
// po spacji — jak w `lib/analysis/evidence.ts`). Długość tekstu, gdy napisów nie ma.
function transcriptStart(material: Pick<FinfluencerMaterial, "text" | "metadata">): number {
  const parsed = transcriptSchema.safeParse(material.metadata);
  if (!parsed.success) return material.text.length;
  const head = parsed.data.transcript.segments
    .map((segment) => segment.text)
    .join(" ")
    .slice(0, 80);
  const at = head ? material.text.lastIndexOf(head) : -1;
  return at >= 0 ? at : material.text.length;
}

function blockAround(text: string, at: number): [number, number] {
  const before = text.lastIndexOf("\n\n", at);
  const after = text.indexOf("\n\n", at);
  return [before < 0 ? 0 : before + 2, after < 0 ? text.length : after];
}

function allIndexes(haystack: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

// Miejsca w tekście, które wskazują firmę: adres i domena jej linku, wzmianki marki.
function firmAnchors(text: string, firm: Firm): number[] {
  return [
    ...(firm.link?.url ? allIndexes(text, firm.link.url) : []),
    ...(firm.link ? allIndexes(text.toLowerCase(), firm.link.domain) : []),
    ...(firm.brand ? brandPositions(text, firm.brand) : []),
  ];
}

// Krótkie części nazwy firmy, po których poznać jej kod („MBXTB”, „XTB2024” dla XTB).
function firmKeys(firm: Firm): string[] {
  return [
    firm.link ? (registrableDomain(firm.link.domain).split(".")[0] ?? "") : "",
    ...[firm.brand?.name ?? "", ...(firm.brand?.aliases ?? [])].map(nameCore),
    nameCore(firm.entity?.name ?? ""),
  ].filter((key) => key.length >= 3);
}

function codeNamesFirm(code: string, keys: readonly string[]): boolean {
  const c = code.toLowerCase();
  // Krótki klucz tylko na początku albo końcu kodu — „ING” jest w „TRADING50”.
  return keys.some(
    (key) => (key.length >= 4 && c.includes(key)) || c.startsWith(key) || c.endsWith(key),
  );
}

// Sygnały reklamy tej firmy. Materiał bywa sponsorowany przez kogoś innego („ZEN jest partnerem
// kanału”, kod MBZEN w filmie o Revolucie), więc kod i fraza liczą się tylko przy firmie: w tym
// samym bloku opisu co jej link albo nazwa, a w długim tekście — blisko nich. Gdy tekst w ogóle
// firmy nie wymienia (jest tylko link w metadanych), liczy się wszystko.
export function collectSignals(material: FinfluencerMaterial, firm: Firm): Signal[] {
  const { text } = material;
  const anchors = firmAnchors(text, firm);
  const nearAny = (points: readonly number[], at: number) =>
    points.some((anchor) => {
      const [start, end] = blockAround(text, anchor);
      return end - start <= BLOCK_MAX_CHARS
        ? at >= start && at < end
        : Math.abs(at - anchor) <= NEAR_CHARS;
    });
  // Ta sama linia, ale nie dalej niż `SAME_LINE_CHARS` — napisy filmu to jedna długa linia.
  const sameLineAny = (points: readonly number[], at: number) =>
    points.some(
      (anchor) =>
        Math.abs(anchor - at) <= SAME_LINE_CHARS &&
        !text.slice(Math.min(anchor, at), Math.max(anchor, at)).includes("\n"),
    );
  // Linia z własnym linkiem to inna oferta z listy („ZEN PRO (kod KBZEN) → https://zen.com”) —
  // jej kod i fraza należą do tamtej oferty, nie do firmy z sąsiedniej linii.
  const otherOffer = (at: number) => {
    const end = text.indexOf("\n", at);
    const line = text.slice(text.lastIndexOf("\n", at - 1) + 1, end < 0 ? undefined : end);
    return OFFER_LINK.test(line) && !sameLineAny(anchors, at);
  };
  const near = (at: number) =>
    anchors.length === 0 || sameLineAny(anchors, at) || (nearAny(anchors, at) && !otherOffer(at));
  const keys = firmKeys(firm);
  const video = videoMetadataSchema.safeParse(material.metadata);
  const meta = video.success ? video.data : {};

  const candidates = new Set(meta.promo_codes ?? []);
  const textCode = extractTextCode(text);
  if (textCode && ![...candidates].some((code) => code.includes(textCode))) {
    candidates.add(textCode);
  }
  const linkUrl = firm.link?.url?.toLowerCase();
  const codes = [...candidates].filter((code) => {
    if (codeNamesFirm(code, keys) || linkUrl?.includes(code.toLowerCase())) return true;
    const positions = allIndexes(text, code);
    // Kod z kolektora, którego nie ma w tekście: przy linku do firmy — jej kod.
    return positions.length === 0 ? firm.link !== null : positions.some(near);
  });

  // Film bywa sponsorowany przez kilka marek — liczy się fraza przy reklamowanej firmie, jej
  // linku albo kodzie („Partnerem odcinka jest XTB”, „Kod: MBXTB”). Pierwszeństwo: fraza
  // wypowiedziana w filmie (dowód z linkiem do sekundy), potem z linii z firmą, potem z jej bloku.
  const phraseAnchors = [...anchors, ...codes.flatMap((code) => allIndexes(text, code))];
  const associated = (at: number) =>
    sameLineAny(phraseAnchors, at) || near(at) || (nearAny(phraseAnchors, at) && !otherOffer(at));
  const phrases = [...text.matchAll(AD_PHRASES_ALL)];
  const spokenFrom = transcriptStart(material);
  const phrase =
    phrases.find((match) => match.index >= spokenFrom && associated(match.index)) ??
    phrases.find((match) => sameLineAny(phraseAnchors, match.index)) ??
    phrases.find((match) => associated(match.index));

  // Etykieta płatnej promocji mówi, że film jest sponsorowany, ale nie przez kogo. Przy samej
  // wzmiance marki liczy się, gdy marka jest w tytule albo ma przy sobie kod lub frazę.
  const inTitle = firm.brand ? brandPositions(material.title ?? "", firm.brand).length > 0 : false;
  const paid =
    meta.paid_promotion === true &&
    (firm.mention === null || inTitle || codes.length > 0 || phrase !== undefined);

  const signals: Signal[] = [];
  if (paid) {
    signals.push({
      kind: "paid_promotion",
      detail: "etykieta „Zawiera płatną promocję”",
      at: null,
    });
  }
  const firstCode = codes[0];
  if (firstCode) {
    const at = text.indexOf(firstCode);
    signals.push({
      kind: "promo_code",
      detail: `kod ${codes.join(", ")}`,
      at: at >= 0 ? at : null,
    });
  }
  if (firm.link) {
    const linkAt = firm.link.url ? text.indexOf(firm.link.url) : -1;
    const domainAt = text.toLowerCase().indexOf(firm.link.domain);
    signals.push({
      kind: firm.link.affiliate ? "affiliate_link" : "direct_link",
      detail: `${firm.link.affiliate ? "link afiliacyjny" : "link"} do ${firm.link.domain}`,
      at: linkAt >= 0 ? linkAt : domainAt >= 0 ? domainAt : null,
    });
  } else if (firm.mention) {
    signals.push({
      kind: "brand_mention",
      detail: `nazwa ${firm.mention.brand.name} w tekście (${firm.mention.count}×), bez linku`,
      at: firm.mention.at,
    });
  }
  if (phrase) {
    // Cytatem jest fraza wypowiedziana w filmie albo z linii z firmą; samo „Współpraca reklamowa”
    // z innej linii mówi mniej niż linia z kodem albo linkiem firmy — wtedy cytat bierze je.
    const quotable = phrase.index >= spokenFrom || sameLineAny(phraseAnchors, phrase.index);
    signals.push({
      kind: "ad_phrase",
      detail: `„${phrase[0]}”`,
      at: quotable ? phrase.index : null,
    });
  }
  return signals;
}

// Rozdział filmu na początku cytatu z opisu („0:11 XTB - Partner odcinka”): od tej sekundy
// leci reklama, więc dowód prowadzi prosto do niej.
const CHAPTER_MARK = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?!\d)/;

export function chapterSeconds(quote: string): number | null {
  const match = CHAPTER_MARK.exec(quote.trim());
  if (!match) return null;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function signalScore(signals: readonly Signal[]): number {
  const kinds = new Set(signals.map((s) => s.kind));
  const clean = [...kinds].reduce((acc, kind) => acc * (1 - SIGNAL_WEIGHTS[kind]), 1);
  return Math.round((1 - clean) * 10_000) / 10_000;
}

const SENTENCE_END = /[.!?…]+(?=\s)/gu;

// Cytat do dowodu: zdanie z sygnałem (fraza ma pierwszeństwo — pada też w napisach, więc daje
// link do sekundy filmu), w obrębie linii i najwyżej 300 znaków. Transkrypcja to jedna długa
// linia, więc okno tniemy na granicy zdania, a gdy jej nie ma — na granicy słowa.
export function signalQuote(text: string, signals: readonly Signal[]): string | null {
  const order: SignalKind[] = [
    "ad_phrase",
    "promo_code",
    "affiliate_link",
    "direct_link",
    "brand_mention",
  ];
  const at = order
    .map((kind) => signals.find((s) => s.kind === kind)?.at ?? null)
    .find((value) => value !== null);
  if (at === undefined || at === null) return null;
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const newline = text.indexOf("\n", at);
  const lineEnd = newline < 0 ? text.length : newline;

  // Od początku zdania z sygnałem — w napisach cytat wyznacza sekundę filmu (`timestamp_s`).
  let start = Math.max(lineStart, at - 140);
  const head = text.slice(start, at);
  const last = [...head.matchAll(SENTENCE_END)].at(-1);
  if (last) start += last.index + last[0].length;
  else if (start > lineStart) {
    const space = head.indexOf(" ");
    if (space >= 0) start += space + 1;
  }
  while (start < at && /\s/.test(text[start] ?? "")) start++;

  let end = Math.min(lineEnd, start + 300);
  if (end < lineEnd) {
    const tail = text.slice(at, end);
    const ends = [...tail.matchAll(SENTENCE_END)];
    const last = ends.at(-1);
    if (last) end = at + last.index + last[0].length;
    else {
      const space = tail.lastIndexOf(" ");
      if (space > 0) end = at + space;
    }
  }
  const quote = text.slice(start, end).trim();
  return quote || null;
}

function m1Flag(
  material: FinfluencerMaterial,
  result: Flag["result"],
  confidence: number,
  reason: string,
  quote: string | null,
): Flag {
  const rule = findRule("finfluencer", "M1.ad");
  return {
    rule_id: "M1.ad",
    rule_name: rule?.name ?? "M1.ad",
    legal_basis: rule?.legalBasis ?? "",
    kind: rule?.kind ?? "hard",
    result,
    confidence,
    reason,
    evidence: m1Evidence(material, quote),
  };
}

// Dowód jak w modułach AI (`buildEvidence`), a dla cytatu z rozdziału filmu — sekunda z rozdziału.
function m1Evidence(material: FinfluencerMaterial, quote: string | null): Flag["evidence"] {
  const evidence = buildEvidence(material, quote);
  if (!evidence || evidence.timestamp_s !== null || material.platform !== "youtube") {
    return evidence;
  }
  const seconds = chapterSeconds(evidence.quote);
  return seconds === null
    ? evidence
    : {
        ...evidence,
        timestamp_s: seconds,
        link: evidenceLink(material.url, material.platform, evidence.quote, seconds),
      };
}

function emptyEntity(advertiser: string | null): IncidentEntity {
  return {
    firm_name: null,
    knf_id: null,
    in_register: null,
    advertiser,
    nip: null,
    domain: null,
    on_warning_list: null,
  };
}

function entityNipOf(firm: Firm): string | null {
  return firm.entity ? entityNip(firm.entity) : null;
}

function advertiserOf(material: FinfluencerMaterial): string | null {
  return material.author ?? (material.platform === "web" ? normalizeDomain(material.url) : null);
}

// Nazwy biur maklerskich banków mają w KNF dwie linie („mBANK S.A.\nBiuro Maklerskie mBank”).
function firmNameOf(firm: Firm): string {
  return (
    firm.entity?.name.replace(/\s+/g, " ").trim() ??
    firm.warning?.entities.slice(0, 300) ??
    firm.link?.domain ??
    firm.mention?.brand.name ??
    ""
  );
}

function firmEntity(
  firm: Firm,
  advertiser: string | null,
  lookup: Pick<FirmLookup, "warnings">,
): IncidentEntity {
  const domain = firm.link?.domain ?? null;
  return {
    firm_name: firmNameOf(firm),
    knf_id: firm.entity?.id ?? null,
    in_register: firm.entity ? firm.entity.investment_register : false,
    advertiser,
    nip:
      entityNipOf(firm) ?? firm.warning?.identifiers.find((i) => i.kind === "NIP")?.value ?? null,
    domain,
    on_warning_list:
      lookup.warnings === null
        ? null
        : matchWarning(lookup.warnings, { domain, nip: entityNipOf(firm) }) !== null,
  };
}

// Status firmy w KNF do podsumowania: rodzaj wpisu mówi analitykowi, czy to polska firma, czy
// zagraniczna działająca w Polsce transgranicznie (docs/ZADANIE.md, moduł 1).
const REGISTER_LABELS: [RegExp, string][] = [
  [/^domy maklerskie/i, "dom maklerski w rejestrze KNF"],
  [/^banki prowadzące działalność maklerską/i, "bank z działalnością maklerską w rejestrze KNF"],
  [/^notyfikacje zagranicznych firm inwestycyjnych/i, "firma zagraniczna z notyfikacją w KNF"],
  [/^notyfikacje zagranicznych instytucji kredytowych/i, "zagraniczny bank z notyfikacją w KNF"],
  [/^agenci firm inwestycyjnych/i, "agent firmy inwestycyjnej w rejestrze KNF"],
];

export function knfStatusOf(firm: Pick<Firm, "entity">): string {
  if (!firm.entity) return "na liście ostrzeżeń KNF";
  const register = firm.entity.register_name.replace(/^firmy inwestycyjne\s*[-–]\s*/i, "").trim();
  const label = REGISTER_LABELS.find(([pattern]) => pattern.test(register))?.[1];
  if (!label) return register ? `w rejestrze KNF: ${register}` : "w rejestrze KNF";
  return /poprzez oddział/i.test(register) ? `${label}, oddział w Polsce` : label;
}

// Własny materiał: kanał o nazwie firmy albo marki, strona z domeny firmy w KNF albo marki.
function isOwnMaterial(material: FinfluencerMaterial, firm: Firm): boolean {
  const ownDomain = normalizeDomain(material.url);
  return (
    isOwnChannel(material.author, firmNameOf(firm)) ||
    isBrandChannel(material.author, firm.brand) ||
    (ownDomain !== null &&
      ((firm.entity?.domains ?? []).some((d) => domainMatches(d, ownDomain)) ||
        (firm.brand !== null && brandOfDomain(ownDomain)?.id === firm.brand.id)))
  );
}

function result(score: number, label: string, details: IncidentDetails): AnalysisResultInput {
  return { module: "finfluencer", score, label, model: FINFLUENCER_MODEL, details };
}

export function buildFinfluencerResult(
  material: FinfluencerMaterial,
  lookup: FirmLookup,
): AnalysisResultInput {
  const advertiser = advertiserOf(material);
  if (!isPolish(material)) {
    return result(0, "inny_jezyk", {
      summary: "Materiał nie jest po polsku — poza zakresem modułu 1 (polski rynek).",
      entity: emptyEntity(advertiser),
      flags: [],
      error: null,
    });
  }
  const firms = findFirmCandidates(material, lookup);
  if (firms.length === 0) {
    const knfDown =
      lookup.warnings === null ||
      lookup.searches.some((search) => search.entities === null) ||
      (lookup.brands ?? []).some((search) => search.entities === null);
    const entity = emptyEntity(advertiser);
    return result(0, knfDown ? "blad_analizy" : "brak_firmy", {
      summary: knfDown
        ? "Nie udało się sprawdzić linków w rejestrze KNF."
        : "Materiał nie linkuje do firmy z rejestru KNF ani z listy ostrzeżeń i nie wymienia żadnej z nich.",
      entity,
      flags: [],
      error: knfDown ? "Wyszukiwarka KNF nie odpowiedziała" : null,
    });
  }

  // Własny materiał firmy (kanał, strona) to przypadek dla modułu 2 — także gdy wymienia innych.
  const ownFirm = firms.find((firm) => isOwnMaterial(material, firm));
  if (ownFirm) {
    const firmName = firmNameOf(ownFirm);
    const reason = `Materiał publikuje sama firma ${firmName} — to przypadek dla modułu 2.`;
    return result(0, "material_firmy", {
      summary: reason,
      entity: firmEntity(ownFirm, advertiser, lookup),
      flags: [m1Flag(material, "n/a", 1, reason, null)],
      error: null,
    });
  }

  // Kilka firm w materiale (porównanie brokerów, kilku sponsorów): reklamowana to ta z
  // najmocniejszymi sygnałami, przy remisie — pierwsza z kandydatów.
  const scored = firms.map((firm) => {
    const signals = collectSignals(material, firm);
    return { firm, signals, score: signalScore(signals) };
  });
  const best = scored.reduce((top, next) => (next.score > top.score ? next : top));
  const { firm, signals, score } = best;
  const firmName = firmNameOf(firm);
  const entity = firmEntity(firm, advertiser, lookup);
  const knfStatus = knfStatusOf(firm);
  const others = [
    ...new Set(
      firms
        .filter((other) => other !== firm)
        .map((other) => other.brand?.name ?? firmNameOf(other)),
    ),
  ];
  const alsoNamed = others.length > 0 ? ` Wymienia też: ${others.slice(0, 3).join(", ")}.` : "";

  const isAd = score >= AD_LABEL_FROM;
  const reason = `Sygnały reklamy: ${signals.map((s) => s.detail).join("; ")}.`;
  const who = advertiser ?? "Podmiot trzeci";
  return result(score, isAd ? "reklama" : "wzmianka", {
    summary: `${who} ${isAd ? "reklamuje" : "wspomina"} ${firmName} (${knfStatus}). ${reason}${alsoNamed}`,
    entity,
    flags: [
      m1Flag(
        material,
        isAd ? "violation" : "ok",
        score,
        reason,
        signalQuote(material.text, signals),
      ),
    ],
    error: null,
  });
}
