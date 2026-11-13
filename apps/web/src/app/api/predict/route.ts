import { NextResponse } from "next/server";
import { z } from "zod";
import { ml } from "@/lib/ml";
import { predictInputSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const parsed = predictInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  try {
    const { data, error } = await ml.POST("/predict", { body: parsed.data });
    if (error || !data) {
      console.error("[api/predict] ML zwrócił błąd:", error);
      return NextResponse.json({ error: "Serwis ML zwrócił błąd" }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/predict] Brak połączenia z ML:", err);
    return NextResponse.json(
      { error: "Serwis ML nie odpowiada — czy działa `pnpm dev`?" },
      { status: 503 },
    );
  }
}
