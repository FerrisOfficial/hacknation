import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

function createDb(url: string, options: { max?: number } = {}) {
  // prepare: false — wymagane przez transaction pooler Supabase.
  const client = postgres(url, { prepare: false, ...options });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// Na Cloudflare Workers połączenia nie wolno współdzielić między żądaniami
// („Cannot perform I/O on behalf of a different request”), więc tam każde getDb() to nowy klient.
// Wołaj getDb() raz na żądanie i przekazuj wynik dalej.
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

// Lokalnie jedno połączenie na proces (globalThis przeżywa hot-reload w `next dev`).
const globalForDb = globalThis as unknown as { db?: Db };

// Leniwie, żeby import @app/db nie wywracał buildu, gdy DATABASE_URL nie jest ustawione.
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("Brak DATABASE_URL (apps/web/.env.local, na Cloudflare: sekret Workera)");
  if (onWorkers) return createDb(url, { max: 1 });
  globalForDb.db ??= createDb(url);
  return globalForDb.db;
}

// Najprostsze zapytanie — do sprawdzenia, czy aplikacja łączy się z bazą (/api/health?db=1).
export async function pingDb(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
