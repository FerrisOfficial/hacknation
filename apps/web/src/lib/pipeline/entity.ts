import "server-only";
import { mentionedBrands } from "@/lib/analysis/brands";
import {
  brandOf,
  type EntityMaterial,
  extractNip,
  type KnfEntity,
  type KnfWarning,
  matchEntity,
  materialDomain,
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

async function knfWarnings(): Promise<KnfWarning[] | null> {
  if (warningsCache && warningsCache.expiresAt > Date.now()) return warningsCache.value;
  const { data } = await ml
    .GET("/knf/warnings", { signal: AbortSignal.timeout(KNF_TIMEOUT_MS) })
    .catch(() => ({ data: undefined }));
  const value = data ?? null;
  warningsCache = { value, expiresAt: Date.now() + (value ? WARNINGS_TTL_MS : FAILURE_TTL_MS) };
  return value;
}

async function knfSearch(phrase: string): Promise<KnfEntity[] | null> {
  const key = phrase.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { data } = await ml
    .GET("/knf/entities", {
      params: { query: { q: phrase } },
      signal: AbortSignal.timeout(KNF_TIMEOUT_MS),
    })
    .catch(() => ({ data: undefined }));
  const value = data?.entities ?? null;
  if (searchCache.size >= MAX_CACHED_SEARCHES) searchCache.clear();
  searchCache.set(key, {
    value,
    expiresAt: Date.now() + (value ? ENTITIES_TTL_MS : FAILURE_TTL_MS),
  });
  return value;
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
export async function lookupPromotedFirm(
  material: Pick<EntityMaterial, "url" | "metadata" | "text">,
): Promise<FirmLookup> {
  const brands = mentionedBrands(material.text).slice(0, MAX_BRANDS);
  const domains = [
    ...new Set(outboundLinks(material).map((link) => registrableDomain(link.domain))),
  ].slice(0, MAX_FIRM_DOMAINS);
  const [warnings, brandSearches, searches] = await Promise.all([
    knfWarnings(),
    Promise.all(
      brands.map(async ({ brand }) => ({
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
