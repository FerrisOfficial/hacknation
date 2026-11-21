import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { handler, readQuery } from "@/lib/api/http";
import { listJobs } from "@/lib/queries/sources";
import { jobsQuerySchema } from "@/lib/schemas";

// GET /api/jobs?sourceId=&status=queued,running&page=&pageSize= — historia kolejki scrapingu.
export const GET = handler("jobs", async (request) => {
  return NextResponse.json(await listJobs(getDb(), readQuery(request, jobsQuerySchema)));
});
