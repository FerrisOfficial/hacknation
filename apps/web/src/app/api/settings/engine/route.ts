import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, readBody } from "@/lib/api/http";
import { scrapePaused, setScrapePaused } from "@/lib/pipeline/engine";

// GET/PUT /api/settings/engine — { paused }: wstrzymanie harmonogramu scrapingu (poza kontraktem).
export const GET = handler("settings/engine", async () => {
  return NextResponse.json({ paused: await scrapePaused(getDb()) });
});

export const PUT = handler("settings/engine", async (request) => {
  const { paused } = await readBody(request, z.object({ paused: z.boolean() }));
  return NextResponse.json({ paused: await setScrapePaused(getDb(), paused) });
});
