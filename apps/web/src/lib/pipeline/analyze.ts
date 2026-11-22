import "server-only";
import { type AnalysisModule, type Db, eq, type Material, materials } from "@app/db";
import type { AnalysisResultInput, AnalyzeOutput } from "@/lib/analysis/contract";
import { buildAnalysisResult } from "@/lib/analysis/details";
import { buildFinfluencerResult } from "@/lib/analysis/finfluencer";
import { AI_MODULES } from "@/lib/analysis/modules";
import { requestedRuleIds } from "@/lib/analysis/rules";
import { analyzeMaterial } from "@/lib/ml";
import { lookupEntity, lookupPromotedFirm, refineEntityByName } from "./entity";
import { followAdvertiserChannel } from "./m1-sources";
import { saveAnalysisResults } from "./results";

export type AnalyzeOutcome = "analyzed" | "skipped" | "missing";

type ModuleOutputs = { module: AnalysisModule; output: AnalyzeOutput }[];

// Wyjście modelu per moduł (§2) → wiersze `analysis_results` z `details` w kształcie §3.
// `entity` (dane KNF) jest wspólne dla modułów AI materiału, więc liczymy je raz.
export async function buildResults(
  material: Material,
  outputs: ModuleOutputs,
): Promise<AnalysisResultInput[]> {
  if (outputs.length === 0) return [];
  const entity = await lookupEntity(material);
  return Promise.all(
    outputs.map(async ({ module, output }) =>
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

// Moduł 1 bez AI: firma z KNF w linkach materiału + sygnały reklamy (`@/lib/analysis/finfluencer`).
export async function runFinfluencer(material: Material): Promise<AnalysisResultInput> {
  return buildFinfluencerResult(material, await lookupPromotedFirm(material));
}

// Analiza materiału: moduł 1 regułami, moduły 2 i 3 przez AI (jedno wywołanie `POST /analyze`
// na moduł, docs/KONTRAKT.md §1). Bez `force` pomija materiał, którego treść nie zmieniła się
// od ostatniej analizy. Gdy AI zawiedzie, wynik modułu 1 i tak trafia do bazy, ale materiał
// nie jest oznaczany jako przeanalizowany — kolejna próba powtórzy moduły 2 i 3.
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
    // Kanał z reklamą staje się źródłem obserwowanym (błąd zapisu źródła nie blokuje analizy).
    await followAdvertiserChannel(db, material, finfluencer).catch(() => false);
    m1.push(finfluencer);
  }
  const outputs: ModuleOutputs = [];
  try {
    for (const module of AI_MODULES.filter(wanted)) {
      const output = await analyzeMaterial(
        {
          material_id: material.id,
          module,
          text: material.text,
          rules: requestedRuleIds(module),
        },
        options.signal,
      );
      outputs.push({ module, output });
    }
  } catch (error) {
    await saveAnalysisResults(db, material, m1, { markAnalyzed: false });
    throw error;
  }
  await saveAnalysisResults(db, material, [...m1, ...(await buildResults(material, outputs))]);
  return "analyzed";
}
