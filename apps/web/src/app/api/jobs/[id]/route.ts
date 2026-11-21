import { getDb } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, readId } from "@/lib/api/http";
import { getJob } from "@/lib/queries/sources";

export const GET = handler("jobs/:id", async (_request, ctx: RouteContext<"/api/jobs/[id]">) => {
  const job = await getJob(getDb(), readId((await ctx.params).id));
  if (!job) throw new HttpError(404, "Nie ma takiego zadania");
  return NextResponse.json(job);
});
