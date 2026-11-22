import { NextResponse } from "next/server";
import { handler } from "@/lib/api/http";
import { currentReviewer } from "@/lib/reviewer";

// GET /api/me — kto pracuje w tej przeglądarce: { id, name, role } (autor decyzji, R16).
// Bez logowania: stały użytkownik z env (UI_USER_NAME, UI_USER_ROLE, UI_USER_ID).
export const GET = handler("me", async () => NextResponse.json(currentReviewer()));
