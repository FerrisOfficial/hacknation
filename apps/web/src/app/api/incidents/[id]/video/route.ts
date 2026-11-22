import { getDb } from "@app/db";
import { HttpError, handler, readId } from "@/lib/api/http";
import { fetchMediaFile, mediaFileResponse } from "@/lib/media";
import { framesDone } from "@/lib/media-state";
import { getIncidentVideoCandidate } from "@/lib/queries/incidents";

// GET /api/incidents/:id/video — pobrany film YouTube (video/mp4) z serwisu media, z obsługą
// `Range` (przewijanie w <video> od oflagowanej sekundy). 404, gdy filmu nie ma.
export const GET = handler(
  "incidents/:id/video",
  async (request, ctx: RouteContext<"/api/incidents/[id]/video">) => {
    const material = await getIncidentVideoCandidate(getDb(), readId((await ctx.params).id));
    if (!material) throw new HttpError(404, "Nie ma takiego incydentu");
    if (!framesDone(material.frames)) throw new HttpError(404, "Film nie jest pobrany");
    const upstream = await fetchMediaFile(
      material.id,
      "video.mp4",
      request.headers.get("range"),
      request.signal,
    );
    if (!upstream) throw new HttpError(502, "Serwis media nie odpowiada");
    if (upstream.status === 404) throw new HttpError(404, "Film nie jest pobrany");
    if (![200, 206, 416].includes(upstream.status)) {
      throw new HttpError(502, `Serwis media zwrócił HTTP ${upstream.status}`);
    }
    return mediaFileResponse(upstream, "private, max-age=3600");
  },
);
