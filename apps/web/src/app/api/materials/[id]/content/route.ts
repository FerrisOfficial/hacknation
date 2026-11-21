import { eq, getDb, materials } from "@app/db";
import { HttpError, handler, readId } from "@/lib/api/http";
import { getContent } from "@/lib/content-store";

// GET /api/materials/:id/content — surowy HTML materiału z bazy treści (dowód do sprawy).
// Zawsze jako text/plain + nosniff: zescrapowany HTML z obcej strony nie może się wykonać
// w originie aplikacji (XSS).
export const GET = handler(
  "materials/:id/content",
  async (_request, ctx: RouteContext<"/api/materials/[id]/content">) => {
    const id = readId((await ctx.params).id);
    const [material] = await getDb()
      .select({ contentRef: materials.contentRef, rawHtml: materials.rawHtml })
      .from(materials)
      .where(eq(materials.id, id));
    if (!material) throw new HttpError(404, "Nie ma takiego materiału");
    const html = material.contentRef ? await getContent(material.contentRef) : material.rawHtml;
    if (html === null) throw new HttpError(404, "Materiał nie ma zapisanej treści HTML");
    return new Response(html, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-disposition": `inline; filename="material-${id}.html.txt"`,
      },
    });
  },
);
