import { z } from "zod";

// Stan pobrania filmu w `materials.metadata.frames` (docs/KONTRAKT.md §1, docs/KLATKI.md).
// `done` = manifest z serwisu media (services/media): film na dysku i klatki dla warstwy AI.
// `queued` = zadanie `download-video` w kolejce, `failed` = pobranie się nie udało (bez
// automatycznego ponawiania; ręcznie: POST /api/materials/:id/video).

export const FRAME_FILE = /^\d{1,9}\.png$/;

const frameItemSchema = z.object({
  ts: z.number().min(0),
  until: z.number().min(0),
  file: z.string().regex(FRAME_FILE),
});

export const mediaManifestSchema = z.object({
  material_id: z.uuid(),
  status: z.literal("done"),
  source_url: z.string(),
  duration_s: z.number().min(0),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  video: z.object({
    file: z.literal("video.mp4"),
    content_type: z.literal("video/mp4"),
    size_bytes: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  policy: z.object({ fps: z.number(), max_frames: z.number().int(), max_height: z.number().int() }),
  items: z.array(frameItemSchema),
  created_at: z.string(),
});

export type MediaManifest = z.infer<typeof mediaManifestSchema>;

const framesStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued"), at: z.string() }),
  z.object({ status: z.literal("failed"), at: z.string(), error: z.string() }),
  mediaManifestSchema,
]);

export type FramesState = z.infer<typeof framesStateSchema>;

// `frames` = wartość `materials.metadata.frames` (dowolny jsonb). null = film nie był zamawiany.
export function readFramesState(frames: unknown): FramesState | null {
  const parsed = framesStateSchema.safeParse(frames);
  return parsed.success ? parsed.data : null;
}

export function framesDone(frames: unknown): boolean {
  return readFramesState(frames)?.status === "done";
}

// Czy zamówić film: tylko YouTube, jeszcze niepobrany. Po błędzie — tylko na wyraźne żądanie.
export function shouldRequestVideo(
  platform: string,
  frames: unknown,
  options: { retry?: boolean } = {},
): boolean {
  if (platform !== "youtube") return false;
  const state = readFramesState(frames);
  if (state?.status === "done") return false;
  return state?.status !== "failed" || options.retry === true;
}
