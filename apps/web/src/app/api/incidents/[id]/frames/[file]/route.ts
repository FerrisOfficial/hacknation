import { getDb } from "@app/db";
import { HttpError, handler, readId } from "@/lib/api/http";
import { fetchMediaFile, mediaFileResponse } from "@/lib/media";
import { FRAME_FILE } from "@/lib/media-state";
import { getIncidentVideoCandidate } from "@/lib/queries/incidents";

// GET /api/incidents/:id/frames/:file — klatka filmu (image/png), `:file` = `evidence.frame.file`
// (docs/KONTRAKT.md §5). Klatki się nie zmieniają, więc przeglądarka może je trzymać w cache.
export const GET = handler(
  "incidents/:id/frames/:file",
  async (request, ctx: RouteContext<"/api/incidents/[id]/frames/[file]">) => {
    const params = await ctx.params;
    const id = readId(params.id);
    if (!FRAME_FILE.test(params.file)) throw new HttpError(404, "Nie ma takiej klatki");
    const material = await getIncidentVideoCandidate(getDb(), id);
    if (!material) throw new HttpError(404, "Nie ma takiego incydentu");
    const upstream = await fetchMediaFile(material.id, params.file, null, request.signal);
    if (!upstream) throw new HttpError(502, "Serwis media nie odpowiada");
    if (upstream.status === 404) throw new HttpError(404, "Nie ma takiej klatki");
    if (!upstream.ok) throw new HttpError(502, `Serwis media zwrócił HTTP ${upstream.status}`);
    return mediaFileResponse(upstream, "private, max-age=86400, immutable");
  },
);
