import "server-only";
import {
  type AnalysisResult,
  analysisResults,
  type Db,
  eq,
  materials,
  type Platform,
  sql,
} from "@app/db";
import { downloadVideo, MediaError } from "@/lib/media";
import { type FramesState, shouldRequestVideo } from "@/lib/media-state";
import { getBoss, QUEUES, type VideoJobData } from "@/lib/queue/boss";
import { publishEventSafe } from "@/lib/realtime/publish";
import { enqueueAnalysis } from "./enqueue";
import { getThresholdSettings } from "./thresholds";

// Filmy YouTube z incydentami: serwis media (services/media) pobiera film i wycina klatki na
// wolumen `media`, backend zapisuje manifest w `materials.metadata.frames`, a ponowna analiza
// wysyła M2 reguły wizualne — warstwa AI czyta klatki z dysku po `material_id` (KONTRAKT.md §1).

export type VideoCandidate = { id: string; platform: Platform; frames: unknown };

async function setFrames(db: Pick<Db, "update">, materialId: string, state: FramesState) {
  await db
    .update(materials)
    .set({
      metadata: sql`jsonb_set(${materials.metadata}, '{frames}', ${JSON.stringify(state)}::jsonb, true)`,
    })
    .where(eq(materials.id, materialId));
}

// Zamówienie pobrania. `retry` = także po wcześniejszym błędzie (ręczne „pobierz ponownie”).
// Zwraca, czy zadanie trafiło do kolejki (już czekające nie jest dublowane).
export async function requestVideo(
  db: Db,
  material: VideoCandidate,
  options: { retry?: boolean } = {},
): Promise<boolean> {
  if (!shouldRequestVideo(material.platform, material.frames, options)) return false;
  const boss = await getBoss();
  const data: VideoJobData = { materialId: material.id };
  const jobId = await boss.send(QUEUES.video, data, { singletonKey: material.id });
  if (jobId) await setFrames(db, material.id, { status: "queued", at: new Date().toISOString() });
  return jobId !== null;
}

// Po analizie: film, który dał incydent (score ≥ próg `flag` któregoś modułu), idzie do pobrania.
export async function requestVideoForIncidents(
  db: Db,
  material: VideoCandidate,
  saved: Pick<AnalysisResult, "module" | "score">[],
): Promise<boolean> {
  if (!shouldRequestVideo(material.platform, material.frames)) return false;
  const settings = await getThresholdSettings(db);
  if (!saved.some((result) => result.score >= settings[result.module].flag)) return false;
  return requestVideo(db, material);
}

// Zadanie kolejki `download-video`. Po sukcesie: manifest w bazie, ponowna analiza (reguły
// wizualne M2) i zdarzenie `result`, żeby otwarte Okno sprawy pokazało odtwarzacz.
export async function runVideoDownload(
  db: Db,
  materialId: string,
  signal?: AbortSignal,
): Promise<void> {
  const [material] = await db
    .select({
      id: materials.id,
      platform: materials.platform,
      url: materials.url,
      frames: sql<unknown>`${materials.metadata}->'frames'`,
    })
    .from(materials)
    .where(eq(materials.id, materialId));
  if (!material || material.platform !== "youtube") return;
  if (!shouldRequestVideo(material.platform, material.frames, { retry: true })) return;

  let manifest: FramesState;
  try {
    manifest = await downloadVideo({ material_id: material.id, url: material.url }, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setFrames(db, material.id, {
      status: "failed",
      at: new Date().toISOString(),
      error: message.slice(0, 500),
    });
    throw error instanceof MediaError ? error : new MediaError(message, true);
  }
  await setFrames(db, material.id, manifest);
  await enqueueAnalysis([material.id], { force: true });

  const results = await db
    .select({
      id: analysisResults.id,
      module: analysisResults.module,
      status: analysisResults.status,
    })
    .from(analysisResults)
    .where(eq(analysisResults.materialId, material.id));
  for (const result of results) {
    await publishEventSafe(db, {
      type: "result",
      resultId: result.id,
      materialId: material.id,
      module: result.module,
      status: result.status,
    });
  }
}
