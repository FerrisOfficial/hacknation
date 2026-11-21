import type { Material } from "@app/db";
import { z } from "zod";
import type { Flag, IncidentDetails, IncidentEntity } from "@/lib/incidents/contract";
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
import { buildEvidence } from "./evidence";
import { findRule } from "./rules";

// Moduł 1 — finfluencerzy i podmioty trzecie — bez modelu AI (docs/ZADANIE.md: moduł ma znaleźć
// reklamę firmy inwestycyjnej publikowaną przez kogoś innego, nie oceniać jej treści).
// Czysta funkcja na sygnałach, które zbierają kolektory:
// 1. bramka: link z materiału prowadzi do firmy z rejestru KNF (albo z listy ostrzeżeń),
//    a materiał nie pochodzi od tej firmy (własna strona / własny kanał to przypadek dla M2);
// 2. score = noisy-OR wag sygnałów reklamy: etykieta płatnej promocji, kod polecający,
//    link afiliacyjny albo bezpośredni do firmy, frazy reklamowe.

export const FINFLUENCER_MODEL = "rules/m1";
export const AD_LABEL_FROM = 0.5;

export const SIGNAL_WEIGHTS = {
  paid_promotion: 0.6,
  promo_code: 0.5,
  affiliate_link: 0.5,
  direct_link: 0.3,
  ad_phrase: 0.3,
} as const;

export type SignalKind = keyof typeof SIGNAL_WEIGHTS;
export type Signal = { kind: SignalKind; detail: string; at: number | null };

export type FinfluencerMaterial = Pick<
  Material,
  "url" | "platform" | "author" | "title" | "text" | "metadata"
>;

// Wyniki KNF per domena główna z linków (`registrableDomain`): null = wyszukiwarka nie odpowiedziała.
export type FirmLookup = {
  searches: { domain: string; entities: readonly KnfEntity[] | null }[];
  warnings: readonly KnfWarning[] | null;
};

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

type Firm = {
  link: OutboundLink;
  entity: KnfEntity | null;
  warning: KnfWarning | null;
};

// Pierwsza domena z linków, która jest firmą z rejestru usług inwestycyjnych; jeśli żadna —
// pierwsza z listy ostrzeżeń KNF (reklama podmiotu bez zezwolenia).
export function findPromotedFirm(
  material: Pick<FinfluencerMaterial, "url" | "metadata">,
  lookup: FirmLookup,
): Firm | null {
  const links = outboundLinks(material);
  for (const link of links) {
    const base = registrableDomain(link.domain);
    const search = lookup.searches.find((s) => s.domain === base);
    const entity = search?.entities
      ? (matchEntity(search.entities, { domain: link.domain, nip: null }) ??
        matchBrand(search.entities, link.domain))
      : null;
    if (entity?.investment_register) return { link, entity, warning: null };
  }
  for (const link of links) {
    const warning = lookup.warnings
      ? matchWarning(lookup.warnings, { domain: link.domain, nip: null })
      : null;
    if (warning) return { link, entity: null, warning };
  }
  return null;
}

export function collectSignals(material: FinfluencerMaterial, firm: Firm): Signal[] {
  const signals: Signal[] = [];
  const video = videoMetadataSchema.safeParse(material.metadata);
  const meta = video.success ? video.data : {};
  if (meta.paid_promotion) {
    signals.push({
      kind: "paid_promotion",
      detail: "etykieta „Zawiera płatną promocję”",
      at: null,
    });
  }
  const codes = new Set(meta.promo_codes ?? []);
  const textCode = extractTextCode(material.text);
  if (textCode && ![...codes].some((code) => code.includes(textCode))) codes.add(textCode);
  const firstCode = [...codes][0];
  if (firstCode) {
    const at = material.text.indexOf(firstCode);
    signals.push({
      kind: "promo_code",
      detail: `kod ${[...codes].join(", ")}`,
      at: at >= 0 ? at : null,
    });
  }
  const linkAt = firm.link.url ? material.text.indexOf(firm.link.url) : -1;
  const domainAt = material.text.toLowerCase().indexOf(firm.link.domain);
  signals.push({
    kind: firm.link.affiliate ? "affiliate_link" : "direct_link",
    detail: `${firm.link.affiliate ? "link afiliacyjny" : "link"} do ${firm.link.domain}`,
    at: linkAt >= 0 ? linkAt : domainAt >= 0 ? domainAt : null,
  });
  // Film bywa sponsorowany przez kilka marek — pierwszeństwo ma fraza z linii, w której pada
  // nazwa reklamowanej firmy albo jej domena („Partnerem odcinka jest XTB”).
  const keys = [
    registrableDomain(firm.link.domain).split(".")[0] ?? "",
    nameCore(firm.entity?.name ?? firm.warning?.entities ?? ""),
  ].filter((key) => key.length >= 3);
  const phrases = [...material.text.matchAll(AD_PHRASES_ALL)];
  const lineOf = (at: number) => {
    const end = material.text.indexOf("\n", at);
    return material.text.slice(material.text.lastIndexOf("\n", at) + 1, end < 0 ? undefined : end);
  };
  const phrase =
    phrases.find((match) => {
      const line = nameCore(lineOf(match.index));
      return keys.some((key) => line.includes(key));
    }) ?? phrases[0];
  if (phrase) {
    signals.push({ kind: "ad_phrase", detail: `„${phrase[0]}”`, at: phrase.index });
  }
  return signals;
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
  const order: SignalKind[] = ["ad_phrase", "promo_code", "affiliate_link", "direct_link"];
  const at = order
    .map((kind) => signals.find((s) => s.kind === kind)?.at ?? null)
    .find((value) => value !== null);
  if (at === undefined || at === null) return null;
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const newline = text.indexOf("\n", at);
  const lineEnd = newline < 0 ? text.length : newline;

  let start = Math.max(lineStart, at - 140);
  if (start > lineStart) {
    const head = text.slice(start, at);
    const ends = [...head.matchAll(SENTENCE_END)];
    const last = ends.at(-1);
    if (last) start += last.index + last[0].length;
    else {
      const space = head.indexOf(" ");
      if (space >= 0) start += space + 1;
    }
  }

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
    evidence: buildEvidence(material, quote),
  };
}

function advertiserOf(material: FinfluencerMaterial): string | null {
  return material.author ?? (material.platform === "web" ? normalizeDomain(material.url) : null);
}

function result(score: number, label: string, details: IncidentDetails): AnalysisResultInput {
  return { module: "finfluencer", score, label, model: FINFLUENCER_MODEL, details };
}

export function buildFinfluencerResult(
  material: FinfluencerMaterial,
  lookup: FirmLookup,
): AnalysisResultInput {
  const advertiser = advertiserOf(material);
  const firm = findPromotedFirm(material, lookup);
  if (!firm) {
    const knfDown =
      lookup.warnings === null || lookup.searches.some((search) => search.entities === null);
    const entity: IncidentEntity = {
      firm_name: null,
      knf_id: null,
      in_register: null,
      advertiser,
      nip: null,
      domain: null,
      on_warning_list: null,
    };
    return result(0, knfDown ? "blad_analizy" : "brak_firmy", {
      summary: knfDown
        ? "Nie udało się sprawdzić linków w rejestrze KNF."
        : "Materiał nie linkuje do firmy z rejestru KNF ani z listy ostrzeżeń.",
      entity,
      flags: [],
      error: knfDown ? "Wyszukiwarka KNF nie odpowiedziała" : null,
    });
  }

  const firmName = firm.entity?.name ?? firm.warning?.entities.slice(0, 300) ?? firm.link.domain;
  const entity: IncidentEntity = {
    firm_name: firmName,
    knf_id: firm.entity?.id ?? null,
    in_register: firm.entity ? firm.entity.investment_register : false,
    advertiser,
    nip:
      (firm.entity ? entityNip(firm.entity) : null) ??
      firm.warning?.identifiers.find((i) => i.kind === "NIP")?.value ??
      null,
    domain: firm.link.domain,
    on_warning_list:
      lookup.warnings === null
        ? null
        : matchWarning(lookup.warnings, { domain: firm.link.domain, nip: null }) !== null,
  };
  const knfStatus = firm.entity ? "w rejestrze KNF" : "na liście ostrzeżeń KNF";

  const ownDomain = normalizeDomain(material.url);
  const own =
    isOwnChannel(material.author, firmName) ||
    (ownDomain !== null && (firm.entity?.domains ?? []).some((d) => domainMatches(d, ownDomain)));
  if (own) {
    const reason = `Materiał publikuje sama firma ${firmName} — to przypadek dla modułu 2.`;
    return result(0, "material_firmy", {
      summary: reason,
      entity,
      flags: [m1Flag(material, "n/a", 1, reason, null)],
      error: null,
    });
  }

  const signals = collectSignals(material, firm);
  const score = signalScore(signals);
  const isAd = score >= AD_LABEL_FROM;
  const reason = `Sygnały reklamy: ${signals.map((s) => s.detail).join("; ")}.`;
  const who = advertiser ?? "Podmiot trzeci";
  return result(score, isAd ? "reklama" : "wzmianka", {
    summary: `${who} ${isAd ? "reklamuje" : "wspomina"} ${firmName} (${knfStatus}). ${reason}`,
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
