// Tempo i limity harmonogramu (czyste funkcje, odczyt zmiennych środowiskowych).

// Limit materiałów w bazie (`MATERIALS_LIMIT`): po jego osiągnięciu harmonogram przestaje
// kolejkować źródła. Ostatnie zadanie może go lekko przekroczyć. 0 = bez limitu.
export const DEFAULT_MATERIALS_LIMIT = 2000;

export function materialsLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MATERIALS_LIMIT;
}

// Ile źródeł harmonogram kolejkuje na tick (co minutę): `SCHEDULER_BATCH`, domyślnie 1, min. 1.
export const DEFAULT_SCHEDULER_BATCH = 1;

export function schedulerBatch(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_SCHEDULER_BATCH;
}
