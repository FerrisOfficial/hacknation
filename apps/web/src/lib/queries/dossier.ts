import "server-only";
import { analysisResults, asc, type Db, eq, materials } from "@app/db";
import { type DossierCase, entityNameOf } from "@/lib/dossier";
import { readIncidentDetails } from "@/lib/incidents/contract";
import { getIncidentDetail, getIncidentSnapshot } from "./incidents";

// Potwierdzone incydenty podmiotu do teczki (Z7), pogrupowane po materiale, od najstarszego.
// Wszystkie potwierdzone, także poniżej obecnego progu `flag`: decyzja analityka zostaje dowodem,
// nawet gdy ktoś później podniesie próg.
export async function loadDossierCases(db: Db, firm: string): Promise<DossierCase[]> {
  const rows = await db
    .select({
      id: analysisResults.id,
      materialId: analysisResults.materialId,
      details: analysisResults.details,
    })
    .from(analysisResults)
    .innerJoin(materials, eq(materials.id, analysisResults.materialId))
    .where(eq(analysisResults.status, "confirmed"))
    .orderBy(asc(materials.scrapedAt), asc(analysisResults.module));

  const byMaterial = new Map<string, string[]>();
  for (const row of rows) {
    if (entityNameOf(readIncidentDetails(row.details)) !== firm) continue;
    byMaterial.set(row.materialId, [...(byMaterial.get(row.materialId) ?? []), row.id]);
  }

  const cases: DossierCase[] = [];
  for (const ids of byMaterial.values()) {
    const incidents = (await Promise.all(ids.map((id) => getIncidentDetail(db, id)))).filter(
      (incident) => incident !== null,
    );
    const [first] = ids;
    if (!first || incidents.length === 0) continue;
    cases.push({ incidents, snapshot: (await getIncidentSnapshot(db, first)) ?? null });
  }
  return cases;
}
