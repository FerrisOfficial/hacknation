import { NextResponse } from "next/server";
import { DEFAULT_REALTIME_PORT, REALTIME_EVENT_TYPES } from "@/lib/realtime/events";

// GET /api/realtime — gdzie przeglądarka ma się podłączyć Socket.io. Port w env serwera, więc
// klient pyta tutaj zamiast mieć go wkompilowanego. Klient: io(`${protocol}//${hostname}:${port}`).
export function GET() {
  const port = Number(process.env.REALTIME_PORT ?? DEFAULT_REALTIME_PORT);
  return NextResponse.json({ port, events: REALTIME_EVENT_TYPES });
}
