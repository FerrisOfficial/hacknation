import { getDb } from "@app/db";
import { HttpError, handler, readQuery } from "@/lib/api/http";
import { buildDossier, dossierFileName } from "@/lib/dossier";
import { loadDossierCases } from "@/lib/queries/dossier";
import { currentReviewer } from "@/lib/reviewer";
import { dossierQuerySchema } from "@/lib/schemas";

// GET /api/entities/dossier?firm=<firm_name> — teczka podmiotu (Z7) jako application/zip:
// potwierdzone materiały z kopią HTML, tekstem, `details` (dowody) i historią decyzji.
// `firm` = nazwa podmiotu jak w liście incydentów (`firm_name`, a bez niej `advertiser`).
export const GET = handler("entities/dossier", async (request) => {
  const { firm } = readQuery(request, dossierQuerySchema);
  const cases = await loadDossierCases(getDb(), firm);
  if (cases.length === 0) throw new HttpError(404, "Podmiot nie ma potwierdzonych materiałów");
  const generatedAt = new Date();
  const zip = buildDossier({ firm, generatedAt, generatedBy: currentReviewer(), cases });
  const fileName = dossierFileName(firm, generatedAt);
  return new Response(Buffer.from(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    },
  });
});
