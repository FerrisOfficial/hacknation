import { getDb, sources } from "@app/db";
import { NextResponse } from "next/server";
import { HttpError, handler, pgErrorCode, readBody } from "@/lib/api/http";
import { enqueueScrape } from "@/lib/pipeline/enqueue";
import { getSource, listSources } from "@/lib/queries/sources";
import { sourceCreateSchema } from "@/lib/schemas";
import { sourceRow } from "@/lib/sources";

// GET /api/sources — monitorowane źródła z liczbą materiałów, ostatnim zadaniem i terminem
// następnego uruchomienia z harmonogramu.
export const GET = handler("sources", async () => {
  return NextResponse.json({ items: await listSources(getDb()) });
});

// POST /api/sources — nowe źródło: strona WWW / profil social media ({ kind: "web_page", url })
// albo wyszukiwanie YouTube ({ kind: "youtube_search", query }). `intervalMinutes` włącza
// harmonogram, `runNow` (domyślnie true) od razu dodaje zadanie do kolejki.
export const POST = handler("sources", async (request) => {
  const input = await readBody(request, sourceCreateSchema);
  const db = getDb();
  let id: string;
  try {
    const [created] = await db
      .insert(sources)
      .values(sourceRow(input))
      .returning({ id: sources.id });
    if (!created) throw new Error("Insert nie zwrócił wiersza");
    id = created.id;
  } catch (error) {
    if (pgErrorCode(error) === "23505")
      throw new HttpError(409, "Źródło o tym adresie już istnieje");
    throw error;
  }
  const job = input.runNow && input.active ? await enqueueScrape(db, id, "manual") : null;
  return NextResponse.json({ source: await getSource(db, id), job }, { status: 201 });
});
