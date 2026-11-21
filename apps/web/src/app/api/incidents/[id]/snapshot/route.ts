import { getDb } from "@app/db";
import { HttpError, handler, readId } from "@/lib/api/http";
import { getIncidentSnapshot } from "@/lib/queries/incidents";

// GET /api/incidents/:id/snapshot — docs/KONTRAKT.md §5: `raw_html` z dnia scrapingu jako
// text/html, do podglądu w <iframe>. To obcy HTML serwowany z originu aplikacji, więc CSP
// `sandbox` bez `allow-scripts` blokuje skrypty, formularze i dostęp do originu (unikalny origin),
// a `script-src 'none'` i `connect-src 'none'` dokładają drugą warstwę. Style i obrazki ładują
// się ze strony źródłowej, żeby kopia wyglądała jak oryginał.
export const GET = handler(
  "incidents/:id/snapshot",
  async (_request, ctx: RouteContext<"/api/incidents/[id]/snapshot">) => {
    const html = await getIncidentSnapshot(getDb(), readId((await ctx.params).id));
    if (html === undefined) throw new HttpError(404, "Nie ma takiego incydentu");
    if (html === null) throw new HttpError(404, "Materiał nie ma zapisanej kopii strony");
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "sandbox; default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; " +
          "style-src https: 'unsafe-inline'; img-src https: data:; font-src https: data:",
        "referrer-policy": "no-referrer",
      },
    });
  },
);
