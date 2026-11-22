import { z } from "zod";
import type { Reviewer } from "@/lib/incidents/contract";

// Kto pracuje w dashboardzie (autor decyzji, R16). Logowania nie ma, więc to jeden użytkownik
// z env: UI_USER_NAME, UI_USER_ROLE i opcjonalnie UI_USER_ID (UUID, stały między restartami,
// żeby historia wskazywała tę samą osobę). Z logowaniem wystarczy podmienić currentReviewer().
// Wiersz w tabeli `reviewers` zapisuje updateIncidentStatus() w @/lib/queries/incidents.

export const DEFAULT_REVIEWER: Reviewer = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Analityk UKNF",
  role: "analityk",
};

const MAX_LENGTH = 120;

export function reviewerFromEnv(env: Record<string, string | undefined>): Reviewer {
  const id = env.UI_USER_ID?.trim();
  const name = env.UI_USER_NAME?.trim().slice(0, MAX_LENGTH);
  const role = env.UI_USER_ROLE?.trim().slice(0, MAX_LENGTH);
  return {
    id: id && z.uuid().safeParse(id).success ? id.toLowerCase() : DEFAULT_REVIEWER.id,
    name: name || DEFAULT_REVIEWER.name,
    // Brak zmiennej = rola domyślna, pusta zmienna = bez roli.
    role: role === undefined ? DEFAULT_REVIEWER.role : role || null,
  };
}

export function currentReviewer(): Reviewer {
  return reviewerFromEnv(process.env);
}
