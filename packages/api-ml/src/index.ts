import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

// schema.d.ts jest GENEROWANY — nie edytuj go ręcznie. Zmieniasz API? Edytuj services/ml,
// potem `pnpm api:generate` w roocie repo.
export type { components, paths };

export type Prediction = components["schemas"]["Prediction"];
export type PredictRequest = components["schemas"]["PredictRequest"];

export function createMlClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type MlClient = ReturnType<typeof createMlClient>;
