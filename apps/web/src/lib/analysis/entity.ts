import type { components } from "@app/api-ml";
import type { Material } from "@app/db";
import { z } from "zod";
import type { IncidentEntity } from "@/lib/incidents/contract";

// `entity` z docs/KONTRAKT.md §3: kogo dotyczy materiał i co o nim wie KNF. Czyste funkcje —
// dane z rejestru i listy ostrzeżeń pobiera `@/lib/pipeline/entity` (przez serwis ML).

export type KnfEntity = components["schemas"]["KnfEntity"];
export type KnfWarning = components["schemas"]["KnfWarning"];

export type EntityMaterial = Pick<Material, "url" | "platform" | "author" | "text" | "metadata">;

// Domeny, które nie identyfikują reklamodawcy (platformy, skracacze linków).
const PLATFORM_DOMAINS = new Set([
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "t.me",
  "telegram.me",
  "bit.ly",
  "tinyurl.com",
  "linktr.ee",
]);

export function normalizeDomain(value: string): string | null {
  const host = (() => {
    try {
      return new URL(value.includes("://") ? value : `https://${value}`).hostname;
    } catch {
      return null;
    }
  })();
  if (!host?.includes(".")) return null;
  return host.toLowerCase().replace(/^www\./, "");
}

// Końcówki z dwóch członów, pod którymi rejestruje się domeny (firma.com.pl, broker.co.uk).
const SECOND_LEVEL_SUFFIXES = new Set([
  "com.pl",
  "net.pl",
  "org.pl",
  "biz.pl",
  "info.pl",
  "waw.pl",
  "co.uk",
  "org.uk",
  "com.cy",
  "com.mt",
  "com.au",
  "co.za",
]);

// Domena główna do wyszukiwarki KNF: KNF zna „xtb.com”, a link afiliacyjny prowadzi na
// „akcje.xtb.com”. Dopasowanie (`domainMatches`) i tak porównuje pełną domenę.
export function registrableDomain(domain: string): string {
  const labels = domain.split(".");
  const size = SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-size).join(".");
}

export function isPlatformDomain(domain: string): boolean {
  return [...PLATFORM_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`));
}

const linksSchema = z.object({
  links: z.array(
    z.object({
      url: z.string().nullable().optional(),
      final_url: z.string().nullable().optional(),
      domain: z.string().nullable().optional(),
      final_domain: z.string().nullable().optional(),
      followed: z.boolean().optional(),
      error: z.string().nullable().optional(),
    }),
  ),
});

// Domena podmiotu: dla strony WWW — jej adres, dla filmu — pierwszy link z opisu poza
// platformami (np. strona brokera z linku afiliacyjnego, po przekierowaniach).
export function materialDomain(material: Pick<EntityMaterial, "url" | "metadata">): string | null {
  const own = normalizeDomain(material.url);
  if (own && !isPlatformDomain(own)) return own;
  const links = linksSchema.safeParse(material.metadata);
  if (!links.success) return null;
  for (const link of links.data.links) {
    const candidate = link.final_domain ?? link.domain;
    const domain = candidate ? normalizeDomain(candidate) : null;
    if (domain && !isPlatformDomain(domain)) return domain;
  }
  return null;
}

export type OutboundLink = {
  // Adres z materiału (przed przekierowaniem).
  url: string | null;
  // Domena, na którą link faktycznie prowadzi (po przekierowaniach, jeśli kolektor je śledził).
  domain: string;
  // Link przez przekierowanie (skracacz, sieć afiliacyjna) albo z parametrem polecającym.
  affiliate: boolean;
};

const REFERRAL_PARAM = /[?&](ref|aff|affiliate|partner|promo|refcode|referral|utm_source)=/i;

// Linki wychodzące materiału (opis filmu, linki ze strony WWW) poza platformami i własną
// domeną materiału, każda domena raz — kandydaci na reklamowaną firmę (moduł 1).
export function outboundLinks(material: Pick<EntityMaterial, "url" | "metadata">): OutboundLink[] {
  const own = normalizeDomain(material.url);
  const parsed = linksSchema.safeParse(material.metadata);
  if (!parsed.success) return [];
  const links = new Map<string, OutboundLink>();
  for (const link of parsed.data.links) {
    const first = link.domain ? normalizeDomain(link.domain) : null;
    const final = link.final_domain ? normalizeDomain(link.final_domain) : first;
    if (!final || final === own || isPlatformDomain(final)) continue;
    // Adres tak, jak stoi w tekście materiału (przed przekierowaniem) — do wskazania cytatu.
    const url = link.url ?? link.final_url ?? null;
    const affiliate =
      (first !== null && first !== final) || REFERRAL_PARAM.test(link.url ?? url ?? "");
    const known = links.get(final);
    links.set(final, {
      url: known?.url ?? url,
      domain: final,
      affiliate: Boolean(known?.affiliate) || affiliate,
    });
  }
  return [...links.values()];
}

// NIP z treści („NIP: 123-456-78-90”). Tylko z poprawną sumą kontrolną.
export function extractNip(text: string): string | null {
  for (const match of text.matchAll(/NIP[:\s.]*((?:\d[\s-]?){9}\d)/gi)) {
    const digits = (match[1] ?? "").replace(/\D/g, "");
    if (isValidNip(digits)) return digits;
  }
  return null;
}

function isValidNip(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return sum % 11 === Number(digits[9]);
}

export function domainMatches(candidate: string, domain: string): boolean {
  const c = normalizeDomain(candidate);
  // Subdomena materiału (pl.broker.example) też należy do podmiotu z broker.example.
  return c !== null && (c === domain || domain.endsWith(`.${c}`));
}

export function entityNip(entity: KnfEntity): string | null {
  const attribute = entity.attributes.find((a) => /^nip$/i.test(a.name.trim()));
  const digits = attribute?.value.replace(/\D/g, "") ?? "";
  return digits.length === 10 ? digits : null;
}

// Marka z domeny do wyszukiwania po nazwie, gdy KNF nie ma domeny w danych podmiotu
// (np. notyfikacje zagranicznych firm): „trading212.com” → „trading 212”. null dla krótkich.
export function brandOf(domain: string): string | null {
  const label = registrableDomain(domain).split(".")[0] ?? "";
  if (label.replace(/[^a-z0-9]/g, "").length < 4) return null;
  return label
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/-/g, " ");
}

// Kolejność wpisów jednej marki: polski rejestr firm inwestycyjnych (dom maklerski, biuro
// maklerskie banku) przed notyfikacją (np. XTB Ltd z grupy XTB), a ta przed agentem.
export function registerRank(register: string): number {
  // Także „Firmy inwestycyjne - Notyfikacje zagranicznych firm inwestycyjnych…”.
  if (/notyfikacj/i.test(register)) return 1;
  if (/^firmy inwestycyjne/i.test(register.trim())) return 0;
  return 2;
}

export function byRegisterRank(a: KnfEntity, b: KnfEntity): number {
  return registerRank(a.register_name) - registerRank(b.register_name);
}

// Podmiot z rejestru usług inwestycyjnych, którego nazwa zaczyna się od marki z domeny
// („Trading 212 Markets Ltd” dla trading212.com).
export function matchBrand(entities: readonly KnfEntity[], domain: string): KnfEntity | null {
  const brand = brandOf(domain)?.replace(/[^a-z0-9]/g, "");
  if (!brand) return null;
  const candidates = entities.filter(
    (entity) =>
      entity.investment_register &&
      entity.name
        .toLowerCase()
        .replace(/[^\p{L}\d]/gu, "")
        .startsWith(brand),
  );
  return [...candidates].sort(byRegisterRank)[0] ?? null;
}

// Podmiot z wyników wyszukiwarki KNF, który pasuje do materiału (NIP albo domena).
// Pierwszeństwo ma aktualny wpis w rejestrze usług inwestycyjnych.
export function matchEntity(
  entities: readonly KnfEntity[],
  { domain, nip }: { domain: string | null; nip: string | null },
): KnfEntity | null {
  const matching = entities.filter(
    (entity) =>
      (nip !== null && entityNip(entity) === nip) ||
      (domain !== null && entity.domains.some((d) => domainMatches(d, domain))),
  );
  return matching.find((entity) => entity.investment_register) ?? matching[0] ?? null;
}

export function matchWarning(
  warnings: readonly KnfWarning[],
  { domain, nip }: { domain: string | null; nip: string | null },
): KnfWarning | null {
  return (
    warnings.find(
      (warning) =>
        (nip !== null && warning.identifiers.some((i) => i.kind === "NIP" && i.value === nip)) ||
        (domain !== null && warning.domains.some((d) => domainMatches(d, domain))),
    ) ?? null
  );
}

export type KnfLookup = {
  // null = wyszukiwarki KNF nie udało się zapytać (nie wiadomo, czy podmiot jest w rejestrze).
  entities: readonly KnfEntity[] | null;
  warnings: readonly KnfWarning[] | null;
};

// Skleja `entity` z danych materiału i odpowiedzi KNF. `in_register`:
// true/false — znaleziony podmiot ma / nie ma aktualnego wpisu w rejestrze usług inwestycyjnych,
// false — wyszukiwarka KNF nie zna podmiotu o tej domenie ani NIP-ie,
// null — nie było czego szukać (brak domeny i NIP-u) albo KNF nie odpowiedział.
export function resolveEntity(material: EntityMaterial, lookup: KnfLookup): IncidentEntity {
  const domain = materialDomain(material);
  const nip = extractNip(material.text);
  const key = { domain, nip };
  const entity = lookup.entities ? matchEntity(lookup.entities, key) : null;
  const warning =
    lookup.warnings && (domain !== null || nip !== null)
      ? matchWarning(lookup.warnings, key)
      : null;
  const hasKey = domain !== null || nip !== null;
  const searched = lookup.entities !== null && hasKey;
  return {
    firm_name: entity?.name ?? (warning ? warning.entities.slice(0, 300) : null),
    knf_id: entity?.id ?? null,
    in_register: entity ? entity.investment_register : searched ? false : null,
    advertiser: material.platform === "web" ? null : (material.author ?? null),
    nip: nip ?? (entity ? entityNip(entity) : null),
    domain,
    on_warning_list: lookup.warnings === null || !hasKey ? null : warning !== null,
  };
}
