// PreToolUse (Edit | Write | MultiEdit | NotebookEdit): agent nie edytuje ręcznie plików, które
// powstają z narzędzi albo należą do człowieka. Zamiast tego dostaje polecenie, które je tworzy.
// Zasady źródłowe: CLAUDE.md, sekcja „Zasady”.
import { block, readInput, repoPath } from "./lib.mjs";

const RULES = [
  {
    test: (p) => p === "packages/api-ml/src/schema.d.ts" || p === "packages/api-ml/openapi.json",
    why: "Typy klienta ML są generowane z OpenAPI FastAPI.",
    fix: "Zmień endpoint/modele pydantic w services/ml, potem `pnpm api:generate` i commit wygenerowanych plików.",
  },
  {
    test: (p) => p.startsWith("packages/db/drizzle/"),
    why: "Migracje i snapshoty Drizzle są generowane, a starych migracji nie edytujemy.",
    fix: "Zmień packages/db/src/schema.ts i uruchom `pnpm db:generate` (skill: migracja-bazy).",
  },
  {
    test: (p) => p === "pnpm-lock.yaml",
    why: "Lockfile pnpm edytuje tylko pnpm.",
    fix: "`pnpm add <pakiet>` w odpowiednim pakiecie albo `pnpm install` przy konflikcie.",
  },
  {
    test: (p) => p.endsWith("/uv.lock") || p === "uv.lock",
    why: "Lockfile uv edytuje tylko uv.",
    fix: "`uv add <pakiet>` w services/ml lub services/media, przy konflikcie `uv lock`.",
  },
  {
    test: (p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !p.endsWith(".example"),
    why: "Pliki .env trzymają sekrety i lokalną konfigurację — należą do człowieka.",
    fix: "Dopisz nową zmienną do odpowiedniego .env.example (i do compose.yaml), a wartość niech ustawi człowiek.",
  },
  {
    test: (p) =>
      p.includes("/node_modules/") || p.includes("/.venv/") || p.startsWith("node_modules/"),
    why: "Zależności instalowanych pakietów nie łatamy w miejscu.",
    fix: "Zmień wersję przez `pnpm add` / `uv add` albo obejdź problem w naszym kodzie.",
  },
];

const input = readInput();
const toolInput = input.tool_input ?? {};
const path = repoPath(toolInput.file_path ?? toolInput.notebook_path);

if (path && !path.startsWith("..")) {
  const rule = RULES.find((r) => r.test(path));
  if (rule) block(`Zablokowano edycję ${path}. ${rule.why}\nZamiast tego: ${rule.fix}`);
}
