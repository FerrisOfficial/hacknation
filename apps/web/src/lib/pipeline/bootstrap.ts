import "server-only";
import {
  analysisResults,
  count,
  type Db,
  incidentEvents,
  materials,
  type NewIncidentEvent,
  reviewers,
} from "@app/db";
import { contentHash } from "@/lib/content-hash";
import { currentReviewer } from "@/lib/reviewer";
import { demoItems, iveMode } from "./demo-data";
import { setScrapePaused } from "./engine";
import { seedM1Sources, seedM3Sources } from "./m1-sources";

// Start stosu zależny od IVE_MODE (README, „Quick Start”):
// - `quick`: zbiór demo w pustej bazie, źródła M1/M3 widoczne, harmonogram wstrzymany (bez sieci),
// - `full`:  źródła M1/M3 od razu w harmonogramie (prawdziwe zbieranie i analiza) + zbiór demo
//            z decyzjami analityka, żeby Kalibracja liczyła FP/FN od pierwszej minuty,
// - brak / inna wartość: nic (development, testy).
export async function bootstrap(db: Db): Promise<void> {
  const mode = iveMode();
  if (!mode) return;

  // Tylko przy pierwszym starcie (pusta baza). Baza z danymi zostaje nietknięta: źródła zmienione
  // albo usunięte w zakładce Źródła i stan harmonogramu nie wracają po restarcie kontenera.
  const [row] = await db.select({ n: count() }).from(materials);
  if ((row?.n ?? 0) > 0) return;

  await setScrapePaused(db, mode === "quick");
  await seedM1Sources(db);
  await seedM3Sources(db);
  const inserted = await seedDemo(db);
  console.info(`[bootstrap] IVE_MODE=${mode}: zbiór demo, ${inserted} wyników`);
}

async function seedDemo(db: Db): Promise<number> {
  const reviewer = currentReviewer();
  const items = demoItems();
  await db.transaction(async (tx) => {
    await tx.insert(reviewers).values(reviewer).onConflictDoNothing();
    for (const item of items) {
      const at = new Date(Date.now() - item.hoursAgo * 3_600_000);
      const hash = contentHash(item.text);
      const [material] = await tx
        .insert(materials)
        .values({
          platform: item.platform,
          url: item.url,
          title: item.title,
          author: item.author,
          text: item.text,
          contentHash: hash,
          analyzedHash: hash,
          analyzedAt: at,
          language: "pl",
          publishedAt: at,
          scrapedAt: at,
          metadata: { kind: "demo" },
        })
        .onConflictDoNothing()
        .returning({ id: materials.id });
      if (!material) continue;
      const reviewed = item.status !== "new";
      const [result] = await tx
        .insert(analysisResults)
        .values({
          materialId: material.id,
          module: item.module,
          score: item.score,
          riskScore: item.score,
          label: item.label,
          details: item.details,
          model: item.model,
          status: item.status,
          reviewedBy: reviewed ? reviewer.id : null,
          reviewedAt: reviewed ? new Date(at.getTime() + 3_600_000) : null,
          createdAt: at,
          updatedAt: at,
        })
        .returning({ id: analysisResults.id });
      if (!result) continue;
      const events: NewIncidentEvent[] = [
        { resultId: result.id, kind: "flagged", action: `oflagowano ${item.score.toFixed(2)}`, at },
      ];
      if (reviewed) {
        events.push({
          resultId: result.id,
          kind: "status",
          actorId: reviewer.id,
          action: "decyzja analityka (zbiór demo)",
          status: item.status,
          at: new Date(at.getTime() + 3_600_000),
        });
      }
      await tx.insert(incidentEvents).values(events);
    }
  });
  return items.length;
}
