// pre-push: nie wypycha na main i uruchamia lint + typy (Turbo cache'uje, więc powtórka trwa
// sekundy). Testy, audyt zależności, Docker Compose i e2e sprawdza CI na PR.
import { readFileSync } from "node:fs";
import { fail, step } from "./common.mjs";

// Git podaje na stdin: <lokalny ref> <lokalny sha> <zdalny ref> <zdalny sha>, po linii na ref.
const refs = readFileSync(0, "utf8").split("\n").filter(Boolean);
if (refs.some((line) => line.split(" ")[2] === "refs/heads/main")) {
  fail("Push na main jest zablokowany — main zmienia się tylko przez PR z zielonym CI.");
}

if (
  !step("Lint i typy (turbo run lint typecheck)", "pnpm", [
    "exec",
    "turbo",
    "run",
    "lint",
    "typecheck",
  ])
) {
  fail("Lint albo typy nie przechodzą. Napraw przed push (CI i tak odrzuci PR).");
}
