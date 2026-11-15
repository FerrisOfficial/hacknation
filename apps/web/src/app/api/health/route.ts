import { pingDb } from "@app/db";
import { type NextRequest, NextResponse } from "next/server";

// GET /api/health — czy aplikacja żyje.
// GET /api/health?db=1 — dodatkowo czy łączy się z bazą (np. po wdrożeniu na Cloudflare).
export async function GET(request: NextRequest) {
  if (!request.nextUrl.searchParams.has("db")) {
    return NextResponse.json({ status: "ok" });
  }
  try {
    await pingDb();
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch (error) {
    console.error("[api/health] Baza nie odpowiada:", error);
    return NextResponse.json({ status: "error", db: "error" }, { status: 503 });
  }
}
