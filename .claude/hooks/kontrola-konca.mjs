// Stop: zanim agent odda turę, sprawdza trzy rzeczy, o których najłatwiej zapomnieć. To te same
// warunki, które potem sprawdza CI — tylko kilka minut wcześniej i bez czekania na runnera.
//   1. API serwisu ML zmienione, a typy klienta (packages/api-ml) nie wygenerowane.
//   2. Schemat bazy zmieniony bez nowej migracji.
//   3. Kod zmieniony po ostatnim udanym `pnpm check` (zapisuje go zapisz-check.mjs).
// Blokuje najwyżej raz na turę (`stop_hook_active`), więc agent nie wpadnie w pętlę: albo naprawi,
// albo powie użytkownikowi wprost, czego nie zrobił.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { block, git, ROOT, readInput, run } from "./lib.mjs";
import { lastCheckAt } from "./stan.mjs";

const input = readInput();
if (input.stop_hook_active) process.exit(0);

const base = git("merge-base", "HEAD", "origin/main") || "HEAD";
const changed = new Set(
  [git("diff", "--name-only", base), git("ls-files", "--others", "--exclude-standard")]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);
if (changed.size === 0) process.exit(0);

const problems = [];

// 1. Kontrakt TS ↔ Python: ta sama kontrola co w CI („Kontrakt API”), ale na pliku tymczasowym.
if ([...changed].some((p) => p.startsWith("services/ml/src/"))) {
  const dir = mkdtempSync(join(tmpdir(), "openapi-"));
  const fresh = join(dir, "openapi.json");
  const result = run("uv", [
    "run",
    "--directory",
    "services/ml",
    "python",
    "-m",
    "ml.openapi",
    fresh,
  ]);
  const committed = join(ROOT, "packages/api-ml/openapi.json");
  if (
    result.ok &&
    existsSync(fresh) &&
    readFileSync(fresh, "utf8") !== readFileSync(committed, "utf8")
  ) {
    problems.push(
      "API serwisu ML różni się od packages/api-ml/openapi.json. Uruchom `pnpm api:generate` i dołącz wygenerowane pliki (skill: zmiana-api-ml).",
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

// 2. Schemat bazy bez migracji.
if (
  changed.has("packages/db/src/schema.ts") &&
  ![...changed].some((p) => p.startsWith("packages/db/drizzle/"))
) {
  problems.push(
    "packages/db/src/schema.ts zmieniony, a w packages/db/drizzle nie ma nowej migracji. Uruchom `pnpm db:generate` (skill: migracja-bazy).",
  );
}

// 3. Kod zmieniony po ostatnim udanym `pnpm check`.
const CODE = /\.(ts|tsx|js|jsx|mjs|py|css|json|ya?ml|toml|sql)$/;
const checkedAt = lastCheckAt();
const stale = [...changed].filter((p) => {
  if (!CODE.test(p) || p.startsWith(".claude/state/")) return false;
  const abs = join(ROOT, p);
  return existsSync(abs) && statSync(abs).mtimeMs > checkedAt;
});
if (stale.length > 0) {
  const list =
    stale.slice(0, 8).join(", ") + (stale.length > 8 ? ` i ${stale.length - 8} innych` : "");
  problems.push(
    `Kod zmieniony po ostatnim udanym \`pnpm check\` (${list}). Uruchom \`pnpm check\` i napraw błędy. Jeśli to tylko przerwa w pracy, napisz użytkownikowi wprost, że check nie był uruchomiony.`,
  );
}

if (problems.length > 0) {
  block(`Zanim skończysz (CLAUDE.md, „Zasady”):\n- ${problems.join("\n- ")}`);
}
