import "server-only";
import { type MediaManifest, mediaManifestSchema } from "@/lib/media-state";

// Klient serwisu media (services/media: pobieranie filmów YouTube i klatek) — tylko po stronie
// serwera. Przeglądarka dostaje film i klatki przez route handlery /api/incidents/:id/…
// Kontrakt jest mały (POST /videos + pliki), więc fetch z walidacją Zod jak przy /analyze.
const MEDIA_API_URL = process.env.MEDIA_API_URL ?? "http://127.0.0.1:8100";

export class MediaError extends Error {
  constructor(
    message: string,
    // false = ponawianie nic nie da (nie YouTube, film za długi, transmisja na żywo).
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

async function errorDetail(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  return `HTTP ${response.status}`;
}

// Pobranie filmu i klatek (POST /videos). Trwa od sekund do minut — wołać z kolejki, nie z UI.
export async function downloadVideo(
  request: { material_id: string; url: string },
  signal?: AbortSignal,
): Promise<MediaManifest> {
  let response: Response;
  try {
    response = await fetch(`${MEDIA_API_URL}/videos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new MediaError("Serwis media nie odpowiada", true);
  }
  if (!response.ok) {
    throw new MediaError(await errorDetail(response), response.status >= 500);
  }
  const parsed = mediaManifestSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MediaError("Serwis media zwrócił zły manifest", false);
  if (parsed.data.material_id !== request.material_id) {
    throw new MediaError("Serwis media zwrócił film innego materiału", false);
  }
  return parsed.data;
}

// Plik z serwisu media (film albo klatka) do przekazania przeglądarce. `range` przechodzi dalej,
// żeby <video> mógł przewijać. null = serwis nie odpowiada.
export async function fetchMediaFile(
  materialId: string,
  file: string,
  range: string | null,
  signal?: AbortSignal,
): Promise<Response | null> {
  const path = file === "video.mp4" ? "video.mp4" : `frames/${encodeURIComponent(file)}`;
  try {
    return await fetch(`${MEDIA_API_URL}/videos/${encodeURIComponent(materialId)}/${path}`, {
      headers: range ? { range } : {},
      signal,
    });
  } catch {
    return null;
  }
}

const PASSED_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

// Odpowiedź serwisu media dla przeglądarki: tylko nagłówki pliku (zakres, długość, typ).
export function mediaFileResponse(upstream: Response, cacheControl: string): Response {
  const headers = new Headers({
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
