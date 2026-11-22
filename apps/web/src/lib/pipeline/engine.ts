import "server-only";
import { appSettings, type Db, eq } from "@app/db";

// Wyłącznik całego silnika scrapingu (przycisk w Źródłach). Stoi harmonogram; ręczne
// „Pobierz teraz” dalej działa, żeby analityk mógł sprawdzić pojedyncze źródło.
const KEY = "scrape_paused";

export async function scrapePaused(db: Db): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return row?.value === true;
}

export async function setScrapePaused(db: Db, paused: boolean): Promise<boolean> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: paused })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: paused, updatedAt: new Date() } });
  return paused;
}
