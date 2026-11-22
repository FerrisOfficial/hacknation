// pre-commit: szybka bramka (sekundy) na plikach w commicie — dla ludzi i agentów AI tak samo.
// Pełny `pnpm check` i testy są w pre-push i w CI.
import { fail, git, step } from "./common.mjs";

if (git("branch", "--show-current") === "main") {
  fail(
    "Commit na main jest zablokowany (main jest chroniony). Utwórz gałąź: git switch -c feat/<opis>",
  );
}

const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
  .split("\n")
  .filter(Boolean);
const changedOld = git("diff", "--cached", "--name-only", "--diff-filter=MD")
  .split("\n")
  .filter(Boolean);

const secrets = staged.filter((p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !p.endsWith(".example"));
if (secrets.length > 0) {
  fail(
    `Plik z sekretami w commicie: ${secrets.join(", ")}. Usuń: git restore --staged <plik>. Wzór zmiennych trzymaj w .env.example.`,
  );
}

const oldMigrations = changedOld.filter((p) => /^packages\/db\/drizzle\/\d+_.*\.sql$/.test(p));
if (oldMigrations.length > 0) {
  fail(
    `Zmiana istniejącej migracji: ${oldMigrations.join(", ")}. Starych migracji nie edytujemy — napraw nową migracją (pnpm db:generate).`,
  );
}

if (
  staged.includes("packages/api-ml/src/schema.d.ts") &&
  !staged.includes("packages/api-ml/openapi.json")
) {
  fail("schema.d.ts zmieniony bez openapi.json — typy klienta generuje tylko `pnpm api:generate`.");
}

let ok = true;
if (staged.some((p) => /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/.test(p))) {
  ok =
    step("Biome (pliki w commicie)", "pnpm", [
      "exec",
      "biome",
      "check",
      "--staged",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
    ]) && ok;
}

for (const service of ["services/ml", "services/media"]) {
  const files = staged
    .filter((p) => p.startsWith(`${service}/`) && p.endsWith(".py"))
    .map((p) => p.slice(service.length + 1));
  if (files.length === 0) continue;
  ok =
    step(`Ruff lint (${service})`, "uv", [
      "run",
      "--directory",
      service,
      "ruff",
      "check",
      ...files,
    ]) && ok;
  ok =
    step(`Ruff format (${service})`, "uv", [
      "run",
      "--directory",
      service,
      "ruff",
      "format",
      "--check",
      ...files,
    ]) && ok;
}

if (!ok) fail("Popraw błędy powyżej (`pnpm format` naprawia formatowanie) i dodaj pliki ponownie.");
