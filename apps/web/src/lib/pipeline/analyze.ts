import "server-only";
import { type AnalysisModule, type Db, eq, type Material, materials } from "@app/db";
import type { AnalysisResultInput, AnalyzeOutput, AnalyzePage } from "@/lib/analysis/contract";
import { buildAnalysisResult } from "@/lib/analysis/details";
import { buildFinfluencerResult } from "@/lib/analysis/finfluencer";
import { inKnfScope } from "@/lib/analysis/knf-scope";
import { AI_MODULES } from "@/lib/analysis/modules";
import { requestedRuleIds } from "@/lib/analysis/rules";
import { videoParts } from "@/lib/analysis/video-parts";
import { getContent } from "@/lib/content-store";
import { type IncidentEntity, readIncidentDetails } from "@/lib/incidents/contract";
import { framesDone } from "@/lib/media-state";
import { analyzeMaterial } from "@/lib/ml";
import { lookupEntity, lookupPromotedFirm, refineEntityByName } from "./entity";
import { followAdvertiserChannel } from "./m1-sources";
import { saveAnalysisResults } from "./results";
import { requestVideoForIncidents } from "./video";

export type AnalyzeOutcome = "analyzed" | "skipped" | "missing";

type ModuleOutputs = { module: AnalysisModule; output: AnalyzeOutput }[];

// Wyjście modelu per moduł (§2) → wiersze `analysis_results` z `details` w kształcie §3.
// `entity` (dane KNF) jest wspólne dla modułów AI materiału, więc liczymy je raz. Wynik M2 dla
// podmiotu spoza rejestru KNF nie powstaje (@/lib/analysis/knf-scope).
export async function buildResults(
  material: Material,
  outputs: ModuleOutputs,
  known?: IncidentEntity,
): Promise<AnalysisResultInput[]> {
  if (outputs.length === 0) return [];
  const entity = known ?? (await lookupEntity(material));
  return Promise.all(
    outputs
      .filter(({ module }) => inKnfScope(module, entity))
      .map(async ({ module, output }) =>
        buildAnalysisResult(
          module,
          output,
          material,
          // M3: firma z treści oferty, której nie znalazła domena ani NIP, sprawdzana po nazwie.
          module === "unauthorized_advisory"
            ? await refineEntityByName(entity, output.subject?.name)
            : entity,
        ),
      ),
  );
}

// Limit `page.html` w serwisie ML (AnalyzePage) — większych stron nie renderujemy.
const PAGE_HTML_MAX = 6_000_000;

// HTML strony z dnia scrapingu (baza treści, starsze materiały: `raw_html`). null = brak kopii.
async function pageSnapshot(material: Material): Promise<AnalyzePage | null> {
  const html = material.contentRef ? await getContent(material.contentRef) : material.rawHtml;
  if (!html || html.length > PAGE_HTML_MAX) return null;
  return { url: material.url, html };
}

// Moduł 1 bez AI: firma z KNF w linkach materiału + sygnały reklamy (`@/lib/analysis/finfluencer`).
export async function runFinfluencer(material: Material): Promise<AnalysisResultInput> {
  return buildFinfluencerResult(material, await lookupPromotedFirm(material));
}

// Analiza materiału: moduł 1 regułami, moduły 2 i 3 przez AI (jedno wywołanie `POST /analyze`
// na moduł, docs/KONTRAKT.md §1). Bez `force` pomija materiał, którego treść nie zmieniła się
// od ostatniej analizy. Gdy AI zawiedzie, wynik modułu 1 i tak trafia do bazy, ale materiał
// nie jest oznaczany jako przeanalizowany — kolejna próba powtórzy moduły 2 i 3.
// Moduły 1 i 2 pomijają materiał, którego podmiot nie ma wpisu w rejestrze KNF: M1 nie zapisuje
// wyniku, a M2 nie woła AI (dane KNF liczymy przed modelem). M3 analizuje każdy materiał.
export async function runAnalysis(
  db: Db,
  materialId: string,
  options: { force?: boolean; signal?: AbortSignal; modules?: readonly AnalysisModule[] } = {},
): Promise<AnalyzeOutcome> {
  const [material] = await db.select().from(materials).where(eq(materials.id, materialId));
  if (!material) return "missing";
  if (!options.force && material.analyzedHash === material.contentHash) return "skipped";

  // `modules`: przeliczenie tylko wybranych modułów — wyniki pozostałych zostają w bazie.
  const wanted = (module: AnalysisModule) => !options.modules || options.modules.includes(module);
  const m1: AnalysisResultInput[] = [];
  if (wanted("finfluencer")) {
    const finfluencer = await runFinfluencer(material);
    if (inKnfScope("finfluencer", readIncidentDetails(finfluencer.details).entity)) {
      // Kanał z reklamą staje się źródłem obserwowanym (błąd zapisu źródła nie blokuje analizy).
      await followAdvertiserChannel(db, material, finfluencer).catch(() => false);
      m1.push(finfluencer);
    }
  }
  const aiModules = AI_MODULES.filter(wanted);
  const entity = aiModules.length > 0 ? await lookupEntity(material) : null;
  const toRun = entity ? aiModules.filter((module) => inKnfScope(module, entity)) : [];
  // Była domena albo NIP, ale KNF nie odpowiedział: M2 odpadł przez awarię, nie przez rejestr.
  // Materiał zostaje do ponownej analizy, żeby M2 nie zginął na stałe.
  const knfDown =
    entity !== null &&
    entity.in_register === null &&
    (entity.domain !== null || entity.nip !== null) &&
    aiModules.some((module) => !toRun.includes(module));
  const outputs: ModuleOutputs = [];
  // Film z wyciętymi klatkami: M2 ocenia też reguły wizualne (4, 5, 6, 8, 13) z klatek na dysku.
  const frames = framesDone(material.metadata.frames);
  // Film YouTube: M2 ocenia regułę 7 (ostrzeżenie tylko w rozwijanym opisie) z części filmu.
  const video = videoParts(material);
  // Strona WWW z zapisanym HTML-em: M2 ocenia reguły 7 i 8 z renderu w Chromium (serwis ML).
  const page =
    video === null && toRun.includes("risk_disclosure") ? await pageSnapshot(material) : null;
  try {
    for (const module of toRun) {
      const m2 = module === "risk_disclosure";
      const m2Video = m2 ? video : null;
      const m2Page = m2 ? page : null;
      const output = await analyzeMaterial(
        {
          material_id: material.id,
          module,
          text: material.text,
          rules: requestedRuleIds(module, {
            frames,
            video: m2Video !== null,
            page: m2Page !== null,
          }),
          ...(m2Video ? { video: m2Video } : {}),
          ...(m2Page ? { page: m2Page } : {}),
        },
        options.signal,
      );
      outputs.push({ module, output });
    }
  } catch (error) {
    await saveAnalysisResults(db, material, m1, { markAnalyzed: false });
    throw error;
  }
  const saved = await saveAnalysisResults(
    db,
    material,
    [...m1, ...(entity ? await buildResults(material, outputs, entity) : [])],
    { markAnalyzed: !knfDown },
  );
  // Film z incydentem idzie do pobrania (Okno sprawy, klatki dla M2). Błąd kolejki nie psuje analizy.
  const candidate = {
    id: material.id,
    platform: material.platform,
    frames: material.metadata.frames,
  };
  await requestVideoForIncidents(db, candidate, saved).catch((error: unknown) => {
    console.error("[analyze] Nie udało się zamówić filmu:", error);
  });
  return "analyzed";
}
