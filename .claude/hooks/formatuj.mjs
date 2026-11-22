// PostToolUse (Edit | Write | MultiEdit): każdy plik zmieniony przez agenta od razu przechodzi przez
// formatter i linter projektu (Biome dla TS/JS/JSON/CSS, Ruff dla Pythona). Bezpieczne poprawki są
// nakładane same, a błędy, których nie da się naprawić automatycznie, wracają do agenta w tej samej
// turze — zanim zdąży o nich zapomnieć. Dzięki temu `pnpm check` i CI rzadko łapią formatowanie.
import { block, readInput, repoPath, run } from "./lib.mjs";

const BIOME = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$/;
const PY_SERVICES = ["services/ml/", "services/media/"];

const input = readInput();
const path = repoPath(input.tool_input?.file_path);

if (path && !path.startsWith("..")) {
  if (BIOME.test(path)) {
    const result = run("pnpm", [
      "exec",
      "biome",
      "check",
      "--write",
      "--no-errors-on-unmatched",
      "--files-ignore-unknown=true",
      path,
    ]);
    if (!result.ok) {
      block(
        `Biome zgłasza błędy w ${path} (formatowanie już poprawione, te trzeba naprawić ręcznie):\n${result.output.slice(-3000)}`,
      );
    }
  }

  const service = PY_SERVICES.find((dir) => path.startsWith(dir));
  if (service && path.endsWith(".py")) {
    const dir = service.slice(0, -1);
    const file = path.slice(service.length);
    run("uv", ["run", "--directory", dir, "ruff", "format", file]);
    const lint = run("uv", ["run", "--directory", dir, "ruff", "check", "--fix", file]);
    // Bez uv w PATH pomijamy krok — Ruff i tak sprawdzi `pnpm check` i CI.
    if (!lint.ok && !lint.missing) {
      block(
        `Ruff zgłasza błędy w ${path} (formatowanie już poprawione, te trzeba naprawić ręcznie):\n${lint.output.slice(-3000)}`,
      );
    }
  }
}
