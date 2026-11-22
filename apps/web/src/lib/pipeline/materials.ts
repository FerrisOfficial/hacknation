import "server-only";
import { type Db, materials, type NewMaterial, sql } from "@app/db";

type Writer = Pick<Db, "insert">;

// Przy ponownym zebraniu tego samego URL-a nadpisujemy treść i metadane najnowszą wersją.
const excluded = (column: { name: string }) => sql.raw(`excluded."${column.name}"`);

export type SavedMaterial = { id: string; contentHash: string; needsAnalysis: boolean };

// Upsert po URL-u. Zwraca, które materiały trzeba (ponownie) przeanalizować: nowe albo z treścią
// zmienioną od ostatniej analizy (`analyzed_hash` ≠ `content_hash`). Ta sama treść = bez kolejki.
export async function upsertMaterials(db: Writer, rows: NewMaterial[]): Promise<SavedMaterial[]> {
  if (rows.length === 0) return [];
  // Upsert w Postgresie nie może dotknąć tego samego wiersza dwa razy w jednym zapytaniu.
  const unique = [...new Map(rows.map((row) => [row.url, row])).values()];
  const saved = await db
    .insert(materials)
    .values(unique)
    .onConflictDoUpdate({
      target: materials.url,
      set: {
        sourceId: excluded(materials.sourceId),
        jobId: excluded(materials.jobId),
        platform: excluded(materials.platform),
        title: excluded(materials.title),
        author: excluded(materials.author),
        rawHtml: excluded(materials.rawHtml),
        contentRef: excluded(materials.contentRef),
        text: excluded(materials.text),
        contentHash: excluded(materials.contentHash),
        language: excluded(materials.language),
        publishedAt: excluded(materials.publishedAt),
        scrapedAt: excluded(materials.scrapedAt),
        // Nowe metadane ze scrapera, ale stan pobranego filmu (`frames`, serwis media) zostaje —
        // inaczej każde ponowne zebranie kanału kasowałoby film i klatki z bazy.
        metadata: sql`case when ${materials.metadata} ? 'frames'
          then ${excluded(materials.metadata)} || jsonb_build_object('frames', ${materials.metadata}->'frames')
          else ${excluded(materials.metadata)} end`,
      },
    })
    .returning({
      id: materials.id,
      contentHash: materials.contentHash,
      analyzedHash: materials.analyzedHash,
    });
  return saved.map(({ id, contentHash, analyzedHash }) => ({
    id,
    contentHash,
    needsAnalysis: analyzedHash !== contentHash,
  }));
}
