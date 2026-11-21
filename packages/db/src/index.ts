import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Operatory zapytań dla aplikacji — jedna wersja drizzle-orm w całym repo.
export { eq, sql } from "drizzle-orm";
export * from "./schema";

function createDb(url: string) {
  return drizzle(postgres(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

// Jedna pula połączeń na proces (globalThis przeżywa hot-reload w `next dev`).
const globalForDb = globalThis as unknown as { db?: Db };

// Leniwie, żeby import @app/db nie wywracał buildu, gdy DATABASE_URL nie jest ustawione.
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Brak DATABASE_URL (apps/web/.env.local — uruchom pnpm env:init)");
  globalForDb.db ??= createDb(url);
  return globalForDb.db;
}

// Najprostsze zapytanie — do sprawdzenia, czy aplikacja łączy się z bazą (/api/health?db=1).
export async function pingDb(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
