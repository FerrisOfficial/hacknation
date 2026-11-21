import "server-only";

// Procesy w tle serwera Next.js: worker kolejki + harmonogram i serwer Socket.io.
// Startuje raz z src/instrumentation.ts. Nie blokuje startu aplikacji: gdy baza jeszcze nie
// wstała (albo jej nie ma, np. w testach e2e), próbuje ponownie z rosnącym odstępem.

const globalForBackground = globalThis as unknown as { investwatchBackground?: boolean };

async function retry(name: string, start: () => Promise<void>): Promise<void> {
  let delay = 5_000;
  let attempt = 0;
  for (;;) {
    try {
      await start();
      if (attempt > 0) console.info(`[background] ${name}: uruchomiony po ${attempt + 1}. próbie`);
      return;
    } catch (error) {
      // Zajęty port to nie chwilowy problem — drugi proces już serwuje Socket.io.
      if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
        console.error(`[background] ${name}: port zajęty, pomijam (${error.message})`);
        return;
      }
      if (attempt === 0) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[background] ${name}: nie wystartował (${message}), ponawiam w tle`);
      }
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 60_000);
    }
  }
}

export function startBackground(): void {
  if (globalForBackground.investwatchBackground) return;
  globalForBackground.investwatchBackground = true;
  if (!process.env.DATABASE_URL) return;

  void import("@/lib/queue/boss").then(({ workerEnabled }) => {
    if (!workerEnabled()) return;
    void retry("Worker kolejki", async () => {
      const { startWorker } = await import("@/lib/queue/worker");
      await startWorker();
    });
    void retry("Socket.io", async () => {
      const { startRealtimeServer } = await import("@/lib/realtime/server");
      await startRealtimeServer();
    });
  });
}
