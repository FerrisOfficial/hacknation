import "server-only";
import { PgBoss, type Queue } from "pg-boss";

// Kolejka zadań: pg-boss (open source) na tej samej bazie Postgres — bez dodatkowej usługi typu
// Redis. pg-boss trzyma swoje tabele w schemacie `pgboss` i sam je zakłada/migruje przy starcie
// (drizzle-kit patrzy tylko na `public`, więc się nie gryzą).
//
// Jedna instancja na proces: route handlery tylko wysyłają zadania (`send`), a worker
// (src/instrumentation.ts → @/lib/queue/worker) je przetwarza i odpala harmonogram (cron).

export const QUEUES = {
  // Jedno uruchomienie scrapera dla źródła. data: { scrapeJobId }
  scrape: "scrape-source",
  // Analiza materiału przez moduły AI w serwisie ML. data: { materialId, force? }
  analyze: "analyze-material",
  // Pobranie filmu YouTube i klatek przez serwis media. data: { materialId }
  video: "download-video",
  // Co minutę: które źródła mają termin ponownego scrapowania (sources.interval_minutes).
  schedulerTick: "scheduler-tick",
} as const;

export type ScrapeJobData = { scrapeJobId: string };
export type AnalyzeJobData = { materialId: string; force?: boolean };
export type VideoJobData = { materialId: string };

const QUEUE_OPTIONS: Record<(typeof QUEUES)[keyof typeof QUEUES], Omit<Queue, "name">> = {
  // `stately` + singletonKey = źródło: najwyżej jedno zadanie w kolejce i jedno w trakcie, więc
  // harmonogram i ręczne „uruchom teraz” nie zdublują scrapowania tego samego źródła.
  [QUEUES.scrape]: {
    policy: "stately",
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
  },
  [QUEUES.analyze]: {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 20,
    retryBackoff: true,
    // Model w Ollamie na CPU potrafi liczyć minutami.
    expireInSeconds: 10 * 60,
  },
  // Klucz = materiał: jeden film pobierany najwyżej raz naraz. Ponowienia z dłuższą przerwą,
  // bo typowy błąd to HTTP 429 z YouTube.
  [QUEUES.video]: {
    policy: "stately",
    retryLimit: 2,
    retryDelay: 120,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
  },
  [QUEUES.schedulerTick]: { policy: "exclusive", retryLimit: 0, expireInSeconds: 120 },
};

// WORKER_ENABLED=false: ten proces tylko wysyła zadania (np. druga replika `web` bez workera).
export function workerEnabled(): boolean {
  return process.env.WORKER_ENABLED !== "false";
}

const globalForBoss = globalThis as unknown as { investwatchBoss?: Promise<PgBoss> };

async function startBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Brak DATABASE_URL — kolejka nie wystartuje");
  const worker = workerEnabled();
  const boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    application_name: "investwatch-queue",
    max: 4,
    // Utrzymanie kolejki (wygaszanie, retencja) i cron tylko w procesie z workerem.
    supervise: worker,
    schedule: worker,
  });
  boss.on("error", (error) => console.error("[queue] pg-boss:", error.message));
  await boss.start();
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    if (await boss.getQueue(name)) continue;
    await boss.createQueue(name, options).catch(async (error: unknown) => {
      // Inny proces mógł ją założyć w międzyczasie.
      if (!(await boss.getQueue(name))) throw error;
    });
  }
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  globalForBoss.investwatchBoss ??= startBoss().catch((error: unknown) => {
    globalForBoss.investwatchBoss = undefined;
    throw error;
  });
  return globalForBoss.investwatchBoss;
}

export async function stopBoss(): Promise<void> {
  const pending = globalForBoss.investwatchBoss;
  globalForBoss.investwatchBoss = undefined;
  if (pending) await (await pending.catch(() => null))?.stop({ graceful: true });
}
