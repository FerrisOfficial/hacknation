// Testy barier dla agentów: `pnpm test:hooks` (uruchamia je też CI).
// Każdy przypadek to wejście hooka (JSON jak z Claude Code) i oczekiwany kod wyjścia: 2 = blokada.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOKS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HOOKS, "..", "..");

function runHook(hook, toolInput) {
  const result = spawnSync("node", [join(HOOKS, hook)], {
    input: JSON.stringify({ tool_input: toolInput }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  return result.status;
}

const files = [
  ["packages/api-ml/src/schema.d.ts", 2],
  [join(ROOT, "packages", "api-ml", "openapi.json"), 2],
  ["packages/db/drizzle/0007_gorgeous_gambit.sql", 2],
  ["packages/db/drizzle/meta/_journal.json", 2],
  ["pnpm-lock.yaml", 2],
  ["services/ml/uv.lock", 2],
  [".env", 2],
  ["apps/web/.env.local", 2],
  ["apps/web/.env.example", 0],
  ["packages/db/src/schema.ts", 0],
  ["apps/web/src/lib/ml.ts", 0],
  ["services/ml/src/ml/risk.py", 0],
];

for (const [file, expected] of files) {
  test(`chron-pliki: ${file} → ${expected}`, () => {
    assert.equal(runHook("chron-pliki.mjs", { file_path: file }), expected);
  });
}

const commands = [
  ["pnpm --filter @app/db exec drizzle-kit push", 2],
  ["docker compose down -v", 2],
  ["docker compose down --volumes", 2],
  ["git push origin main", 2],
  ["git push origin HEAD:main", 2],
  ["git push -f", 2],
  ["git push --force origin feat/x", 2],
  ["git commit --no-verify -m x", 2],
  ["npm install lodash", 2],
  ["cd services/ml && pip install requests", 2],
  ["uv pip install requests", 2],
  ["docker compose down", 0],
  ["git push -u origin feat/main-fix", 0],
  ["git push --force-with-lease", 0],
  ["pnpm dlx shadcn@latest add button", 0],
  ["pnpm check && git status", 0],
  ["uv add httpx", 0],
  // Opis commita lub PR-a może wspominać zakazane polecenia — liczy się tylko to, co się wykona.
  ['gh pr create --title "Hooki" --body "blokujemy drizzle-kit push i --no-verify"', 0],
  ["cat <<'EOF' > notatka.md\ndocker compose down -v kasuje dane\nEOF", 0],
  ['gh pr create --body "opis" && docker compose down -v', 2],
];

for (const [command, expected] of commands) {
  test(`chron-bash: ${command} → ${expected}`, () => {
    assert.equal(runHook("chron-bash.mjs", { command }), expected);
  });
}

test("hook bez wejścia niczego nie blokuje", () => {
  const result = spawnSync("node", [join(HOOKS, "chron-pliki.mjs")], {
    input: "",
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
});
