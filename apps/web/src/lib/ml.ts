import "server-only";
import { createMlClient } from "@app/api-ml";
import {
  type AnalyzeOutput,
  type AnalyzeRequest,
  analyzeOutputSchema,
} from "@/lib/analysis/contract";

// Klient serwisu ML — tylko po stronie serwera. Przeglądarka nigdy nie gada z FastAPI bezpośrednio:
// idzie przez route handlery w src/app/api, gdzie robimy walidację i (później) autoryzację.
// 127.0.0.1, nie localhost: uvicorn słucha na IPv4, a localhost bywa rozwiązywany na ::1.
const ML_API_URL = process.env.ML_API_URL ?? "http://127.0.0.1:8000";

export const ml = createMlClient(ML_API_URL);

export class MlError extends Error {
  constructor(
    message: string,
    // false = nie ma sensu ponawiać (np. endpoint jeszcze nie istnieje, zła odpowiedź).
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MlError";
  }
}

// Ocena materiału przez jeden moduł AI: `POST /analyze` (docs/KONTRAKT.md §1 → §2).
// Endpointu nie ma jeszcze w OpenAPI serwisu ML, więc zamiast typowanego `ml.POST` jest fetch
// z walidacją Zod. Gdy endpoint trafi do `pnpm api:generate` — przepnij na `ml.POST("/analyze")`.
export async function analyzeMaterial(
  request: AnalyzeRequest,
  signal?: AbortSignal,
): Promise<AnalyzeOutput> {
  let response: Response;
  try {
    response = await fetch(`${ML_API_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    throw new MlError("Serwis ML nie odpowiada", true);
  }
  if (response.status === 404) {
    throw new MlError("Serwis ML nie ma jeszcze endpointu POST /analyze", false);
  }
  if (!response.ok) {
    throw new MlError(`POST /analyze zwrócił HTTP ${response.status}`, response.status >= 500);
  }
  const parsed = analyzeOutputSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new MlError("POST /analyze zwrócił odpowiedź niezgodną z kontraktem", false);
  }
  if (parsed.data.material_id !== request.material_id) {
    throw new MlError("POST /analyze zwrócił wynik dla innego materiału", false);
  }
  return parsed.data;
}
