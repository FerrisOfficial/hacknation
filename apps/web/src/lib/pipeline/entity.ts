import "server-only";
import {
  type EntityMaterial,
  extractNip,
  type KnfEntity,
  type KnfWarning,
  materialDomain,
  resolveEntity,
} from "@/lib/analysis/entity";
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
  const phrases = [extractNip(material.text), materialDomain(material)].filter(
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
