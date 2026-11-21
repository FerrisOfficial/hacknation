import "server-only";
import { type Db, sql } from "@app/db";
import { EVENTS_CHANNEL, type RealtimeEvent } from "./events";

// Transakcja drizzle ma to samo API zapytań co Db — publikacja w transakcji wychodzi po COMMIT.
type Executor = Pick<Db, "execute">;

// NOTIFY ma limit 8000 bajtów — zdarzenia niosą tylko identyfikatory i krótkie pola.
const MAX_PAYLOAD = 7_500;

export async function publishEvent(db: Executor, event: RealtimeEvent): Promise<void> {
  let payload = JSON.stringify(event);
  if (payload.length > MAX_PAYLOAD && event.type === "incident.high_risk") {
    payload = JSON.stringify({ ...event, summary: event.summary.slice(0, 500) });
  }
  if (payload.length > MAX_PAYLOAD) return;
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${payload})`);
}

// Powiadomienie to dodatek — jego błąd nie może wywrócić zapisu ani zadania kolejki.
export async function publishEventSafe(db: Executor, event: RealtimeEvent): Promise<void> {
  try {
    await publishEvent(db, event);
  } catch (error) {
    console.error(`[realtime] Nie udało się opublikować zdarzenia ${event.type}:`, error);
  }
}
