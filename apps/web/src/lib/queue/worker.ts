import "server-only";
import { getDb } from "@app/db";
import { MediaError } from "@/lib/media";
import { MlError, ml } from "@/lib/ml";
import { runAnalysis } from "@/lib/pipeline/analyze";
import { enqueueDueSources } from "@/lib/pipeline/scheduler";
import { runScrapeJob, ScrapeJobError } from "@/lib/pipeline/scrape";
import { runVideoDownload } from "@/lib/pipeline/video";
import {
  type AnalyzeJobData,
  getBoss,
  QUEUES,
  type ScrapeJobData,
  type VideoJobData,
} from "./boss";

// Worker kolejki i harmonogram (CronJob): startuje raz na proces z src/instrumentation.ts.

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Ten sam błąd dla setek materiałów (np. ML bez /analyze) — w logu raz na 5 minut, nie setki razy.
const lastLogged = new Map<string, number>();
function logThrottled(message: string): void {
  const now = Date.now();
  if ((lastLogged.get(message) ?? 0) > now - 5 * 60_000) return;
  lastLogged.set(message, now);
  console.error(`[worker] ${message}`);
}

export async function startWorker(): Promise<void> {
  const boss = await getBoss();
  const db = getDb();

  await boss.work<ScrapeJobData>(
    QUEUES.scrape,
    { localConcurrency: envInt("SCRAPE_CONCURRENCY", 2) },
    async ([job]) => {
      if (!job) return;
      try {
        await runScrapeJob(db, ml, job.data.scrapeJobId);
      } catch (error) {
        // Błąd jest już w scrape_jobs.error. Rzucamy dalej, żeby pg-boss ponowił (retryLimit).
        if (error instanceof ScrapeJobError) logThrottled(`Scraping: ${error.message}`);
        throw error;
      }
    },
  );

  await boss.work<AnalyzeJobData>(
    QUEUES.analyze,
    // Domyślnie 1: lokalny model w Ollamie i tak liczy jedno żądanie naraz.
    { localConcurrency: envInt("ANALYZE_CONCURRENCY", 1) },
    async ([job]) => {
      if (!job) return;
      try {
        await runAnalysis(db, job.data.materialId, {
          force: job.data.force ?? false,
          signal: job.signal,
        });
      } catch (error) {
        if (error instanceof MlError && !error.retryable) {
          // Ponawianie nic nie da (brak endpointu, zła odpowiedź) — kończymy zadanie bez retry.
          logThrottled(`Analiza AI: ${error.message}`);
          return;
        }
        logThrottled(`Analiza AI: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
  );

  await boss.work<VideoJobData>(
    QUEUES.video,
    // Domyślnie 1: równoległe pobrania z YouTube kończą się blokadą HTTP 429.
    { localConcurrency: envInt("MEDIA_CONCURRENCY", 1) },
    async ([job]) => {
      if (!job) return;
      try {
        await runVideoDownload(db, job.data.materialId, job.signal);
      } catch (error) {
        logThrottled(`Pobranie filmu: ${error instanceof Error ? error.message : String(error)}`);
        // Błąd jest już w metadata.frames. Ponawiamy tylko to, co ma szansę się udać.
        if (error instanceof MediaError && !error.retryable) return;
        throw error;
      }
    },
  );

  await boss.work(QUEUES.schedulerTick, async () => {
    await enqueueDueSources(db);
  });
  // Cron pg-boss: jeden tick na minutę w całym klastrze, niezależnie od liczby procesów.
  await boss.schedule(QUEUES.schedulerTick, "* * * * *");
}
