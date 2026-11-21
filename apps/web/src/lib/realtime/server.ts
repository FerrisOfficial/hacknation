import "server-only";
import { createServer } from "node:http";
import { getDb } from "@app/db";
import { Server } from "socket.io";
import {
  DEFAULT_REALTIME_PORT,
  EVENTS_CHANNEL,
  REALTIME_EVENT_TYPES,
  type RealtimeEvent,
} from "./events";

// Serwer WebSocket (Socket.io) dla powiadomień w czasie rzeczywistym. Route handlery Next.js nie
// utrzymają połączenia WebSocket, więc to osobny port (REALTIME_PORT, domyślnie 3001) w tym samym
// procesie. Źródłem zdarzeń jest Postgres LISTEN/NOTIFY (kanał `investwatch_events`) — publikuje
// każdy, kto zapisuje (worker, route handlery), także z innego procesu albo kontenera.
//
// Przeglądarka: `io("http://localhost:3001")` (socket.io-client), zdarzenia: incident.high_risk,
// job, result, thresholds — typy w @/lib/realtime/events (`RealtimePayload`).

function corsOrigins(): string[] {
  return (process.env.REALTIME_CORS_ORIGIN ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (REALTIME_EVENT_TYPES as readonly string[]).includes(String(value.type))
  );
}

export async function startRealtimeServer(): Promise<void> {
  const port = Number(process.env.REALTIME_PORT ?? DEFAULT_REALTIME_PORT);
  const host = process.env.REALTIME_HOST ?? "127.0.0.1";

  const http = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const io = new Server(http, {
    serveClient: false,
    cors: { origin: corsOrigins() },
  });

  // Najpierw baza, potem port: gdy baza jeszcze nie wstała, ponowna próba (@/lib/background) nie
  // trafi na port zajęty przez własny serwer z poprzedniej próby. Osobne połączenie postgres.js
  // w trybie LISTEN wznawia się samo po zerwaniu.
  const { unlisten } = await getDb().$client.listen(EVENTS_CHANNEL, (payload) => {
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (!isRealtimeEvent(event)) return;
    const { type, ...data } = event;
    io.emit(type, data);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(port, host, () => {
        http.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await unlisten();
    io.close();
    throw error;
  }
}
