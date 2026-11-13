import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

function createDb(url: string) {
  // prepare: false — wymagane przez transaction pooler Supabase.
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// Jedno połączenie na proces (globalThis przeżywa hot-reload w `next dev`).
const globalForDb = globalThis as unknown as { db?: Db };

// Leniwie, żeby import @app/db nie wywracał buildu, gdy DATABASE_URL nie jest ustawione.
export function getDb(): Db {
  if (!globalForDb.db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Brak DATABASE_URL (apps/web/.env.local)");
    globalForDb.db = createDb(url);
  }
  return globalForDb.db;
}
