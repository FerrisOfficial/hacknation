import "server-only";
import { type Db, type Material, sources } from "@app/db";
import type { AnalysisResultInput } from "@/lib/analysis/contract";
import { channelUrlOf, m1SearchSourceRows, youtubeChannelSourceRow } from "@/lib/m1-sources";
import { m3SearchSourceRows } from "@/lib/m3-sources";

// Zapis źródeł modułu 1. Harmonogram (`enqueueDueSources`) podejmuje je sam: źródło bez
// `last_scraped_at` jest „do zrobienia” przy najbliższym ticku, potem co `interval_minutes`.

// Frazy z marek: nowe źródła dopisuje, istniejącym odświeża konfigurację i interwał.
export async function seedM1Sources(db: Db): Promise<{ sources: number }> {
  const rows = m1SearchSourceRows();
  for (const row of rows) {
    await db
      .insert(sources)
      .values(row)
      .onConflictDoUpdate({
        target: sources.url,
        set: { name: row.name, config: row.config, intervalMinutes: row.intervalMinutes },
      });
  }
  return { sources: rows.length };
}

// Kula śnieżna: kanał, w którym M1 znalazł reklamę, staje się źródłem z harmonogramem.
// Istniejącego źródła nie zmienia (analityk mógł je wyłączyć). Zwraca true, gdy dodał nowe.
export async function followAdvertiserChannel(
  db: Db,
  material: Pick<Material, "platform" | "author" | "metadata">,
  result: Pick<AnalysisResultInput, "label">,
): Promise<boolean> {
  if (material.platform !== "youtube" || result.label !== "reklama") return false;
  const channelUrl = channelUrlOf(material.metadata);
  if (!channelUrl) return false;
  const added = await db
    .insert(sources)
    .values(youtubeChannelSourceRow(channelUrl, material.author))
    .onConflictDoNothing({ target: sources.url })
    .returning({ id: sources.id });
  return added.length > 0;
}

// Frazy modułu 3 (`@/lib/m3-sources`): jak frazy M1 — nowe dopisuje, istniejącym odświeża config.
export async function seedM3Sources(db: Db): Promise<{ sources: number }> {
  const rows = m3SearchSourceRows();
  for (const row of rows) {
    await db
      .insert(sources)
      .values(row)
      .onConflictDoUpdate({
        target: sources.url,
        set: { name: row.name, config: row.config, intervalMinutes: row.intervalMinutes },
      });
  }
  return { sources: rows.length };
}
