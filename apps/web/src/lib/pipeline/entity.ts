import "server-only";
import { type Brand, brandOfDomain, mentionedBrands } from "@/lib/analysis/brands";
import {
  brandOf,
  type EntityMaterial,
  entityNip,
  extractNip,
  type KnfEntity,
  type KnfWarning,
  matchByName,
  matchEntity,
  materialDomain,
  normalizeFirmName,
  outboundLinks,
  registrableDomain,
  resolveEntity,
} from "@/lib/analysis/entity";
import type { FirmLookup } from "@/lib/analysis/finfluencer";
import type { IncidentEntity } from "@/lib/incidents/contract";
import { ml } from "@/lib/ml";

// Dane KNF do `entity` (docs/KONTRAKT.md §3): wyszukiwarka podmiotów i lista ostrzeżeń
// publicznych, pobierane przez serwis ML (`GET /knf/entities`, `GET /knf/warnings`).
// Cache w pamięci procesu — worker analizuje wiele materiałów tej samej firmy, a KNF nie trzeba
// pytać o to samo co kilka sekund. Błąd KNF nie blokuje analizy: pola zostają null.

const WARNINGS_TTL_MS = 6 * 60 * 60 * 1000;
const ENTITIES_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const KNF_TIMEOUT_MS = 20_000;
const MAX_CACHED_SEARCHES = 2_000;

type Cached<T> = { value: T; expiresAt: number };

let warningsCache: Cached<KnfWarning[] | null> | null = null;
const searchCache = new Map<string, Cached<KnfEntity[] | null>>();

let warningsInFlight: Promise<KnfWarning[] | null> | null = null;

async function fetchKnfWarnings(): Promise<KnfWarning[] | null> {
  const { data } = await ml
    .GET("/knf/warnings", { signal: AbortSignal.timeout(KNF_TIMEOUT_MS) })
    .catch(() => ({ data: undefined }));
  const value = data ?? null;
  warningsCache = { value, expiresAt: Date.now() + (value ? WARNINGS_TTL_MS : FAILURE_TTL_MS) };
  return value;
}

// Jedno pobranie listy ostrzeżeń naraz — po starcie workera pyta o nią każda analiza.
async function knfWarnings(): Promise<KnfWarning[] | null> {
  if (warningsCache && warningsCache.expiresAt > Date.now()) return warningsCache.value;
  warningsInFlight ??= fetchKnfWarnings().finally(() => {
    warningsInFlight = null;
  });
  return warningsInFlight;
}

// Zapytania w toku: wyszukiwarka KNF obsługuje zapytania po kolei i przy kilku naraz odpowiada
// po kilkanaście sekund albo wcale, a te same frazy („XTB”, „Biuro Maklerskie”) sprawdza
// jednocześnie wiele materiałów — jedno zapytanie na frazę.
const searchesInFlight = new Map<string, Promise<KnfEntity[] | null>>();
const KNF_RETRY_DELAY_MS = 3_000;

async function fetchKnfSearch(phrase: string): Promise<KnfEntity[] | null> {
  const attempt = () =>
    ml
      .GET("/knf/entities", {
        params: { query: { q: phrase } },
        signal: AbortSignal.timeout(KNF_TIMEOUT_MS),
      })
      .then(({ data }) => data?.entities ?? null)
      .catch(() => null);
  const first = await attempt();
  if (first) return first;
  // Jedna ponowna próba — KNF często nie odpowiada tylko chwilowo.
  await new Promise((resolve) => setTimeout(resolve, KNF_RETRY_DELAY_MS));
  return attempt();
}

async function knfSearch(phrase: string): Promise<KnfEntity[] | null> {
  const key = phrase.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = searchesInFlight.get(key);
  if (pending) return pending;
  const request = fetchKnfSearch(phrase).then((value) => {
    if (searchCache.size >= MAX_CACHED_SEARCHES) searchCache.clear();
    searchCache.set(key, {
      value,
      expiresAt: Date.now() + (value ? ENTITIES_TTL_MS : FAILURE_TTL_MS),
    });
    return value;
  });
  searchesInFlight.set(key, request);
  try {
    return await request;
  } finally {
    searchesInFlight.delete(key);
  }
}

// Szukamy po NIP-ie z treści i po domenie. Wyszukiwarka KNF zwraca podmioty ze wszystkich
// rejestrów — który pasuje, rozstrzyga `resolveEntity`.
export async function lookupEntity(material: EntityMaterial): Promise<IncidentEntity> {
  const domain = materialDomain(material);
  const phrases = [extractNip(material.text), domain && registrableDomain(domain)].filter(
    (phrase): phrase is string => phrase !== null,
  );
  const [warnings, searches] = await Promise.all([
    knfWarnings(),
    Promise.all(phrases.map((phrase) => knfSearch(phrase))),
  ]);
  const entities =
    phrases.length === 0 || searches.some((result) => result === null)
      ? null
      : searches.flatMap((result) => result ?? []);
  return resolveEntity(material, { entities, warnings });
}

// Moduł 1: ile domen z linków materiału sprawdzamy w KNF (opisy filmów mają ich kilkanaście).
const MAX_FIRM_DOMAINS = 5;

// Moduł 1: ile marek wymienionych w tekście sprawdzamy w KNF.
const MAX_BRANDS = 3;

// Dane KNF dla domen z linków wychodzących i marek z tekstu — kandydatów na reklamowaną firmę.
// Marki szukamy też dla domen z linków (`brandOfDomain`): wpis po marce ma pierwszeństwo przed
// wpisem po domenie (XTB S.A. zamiast XTB Ltd, biuro maklerskie banku zamiast samego banku).
export async function lookupPromotedFirm(
  material: Pick<EntityMaterial, "url" | "metadata" | "text">,
): Promise<FirmLookup> {
  const domains = [
    ...new Set(outboundLinks(material).map((link) => registrableDomain(link.domain))),
  ].slice(0, MAX_FIRM_DOMAINS);
  const brands = new Map<string, Brand>();
  for (const { brand } of mentionedBrands(material.text).slice(0, MAX_BRANDS)) {
    brands.set(brand.id, brand);
  }
  for (const domain of domains) {
    const brand = brandOfDomain(domain);
    if (brand) brands.set(brand.id, brand);
  }
  const [warnings, brandSearches, searches] = await Promise.all([
    knfWarnings(),
    Promise.all(
      [...brands.values()].map(async (brand) => ({
        id: brand.id,
        entities: await knfSearch(brand.knfQuery),
      })),
    ),
    Promise.all(
      domains.map(async (domain) => {
        // Po domenie, a gdy żaden wynik nie ma tej domeny — po marce z domeny (`brandOf`).
        const byDomain = await knfSearch(domain);
        const matched = byDomain ? matchEntity(byDomain, { domain, nip: null }) : null;
        const brand = byDomain && !matched ? brandOf(domain) : null;
        const byBrand = brand ? await knfSearch(brand) : [];
        return { domain, entities: byDomain && byBrand ? [...byDomain, ...byBrand] : null };
      }),
    ),
  ]);
  return { searches, warnings, brands: brandSearches };
}

// Moduł 3: gdy domena i NIP nie wskazały podmiotu, szukamy w KNF po nazwie firmy z treści oferty.
// Brak wpisu o tej nazwie = podmiot spoza rejestru (`in_register: false`). Błąd KNF nic nie zmienia.
export async function refineEntityByName(
  entity: IncidentEntity,
  name: string | null | undefined,
): Promise<IncidentEntity> {
  if (!name || entity.knf_id !== null || normalizeFirmName(name).length < 4) return entity;
  const results = await knfSearch(name);
  if (results === null) return entity;
  const match = matchByName(results, name);
  if (!match) return { ...entity, firm_name: entity.firm_name ?? name, in_register: false };
  return {
    ...entity,
    firm_name: match.name,
    knf_id: match.id,
    in_register: match.investment_register,
    nip: entity.nip ?? entityNip(match),
  };
}
