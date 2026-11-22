// Wspólne funkcje hooków Claude Code (.claude/settings.json). Hooki są w Node, bo Node 24 i tak
// jest wymagany w repo, a skrypt .mjs działa tak samo na Windowsie, macOS i Linuksie.
//
// Protokół (https://docs.claude.com/en/docs/claude-code/hooks): hook dostaje JSON na stdin.
// Kod wyjścia 2 = blokada, a stderr trafia do agenta jako informacja zwrotna. Kod 0 = przepuść.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT =
  process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Wejście hooka z stdin (puste lub niepoprawne → pusty obiekt, hook nic nie blokuje). */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

/** Ścieżka względem roota repo, zawsze z „/” (Windows podaje „\”). */
export function repoPath(file) {
  if (!file) return "";
  const abs = isAbsolute(file) ? file : join(ROOT, file);
  return relative(ROOT, abs).split(sep).join("/");
}

/** Blokuje akcję agenta: komunikat idzie do modelu, który ma poprawić podejście. */
export function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/**
 * Uruchamia polecenie w roocie repo. Zwraca { ok, output, missing } zamiast rzucać wyjątek.
 * `missing` = narzędzia nie ma w PATH (np. brak uv) — hook wtedy pomija krok, zamiast blokować.
 */
export function run(command, args, options = {}) {
  // pnpm na Windowsie to pnpm.cmd — Node uruchamia pliki .cmd tylko przez powłokę.
  const shell = process.platform === "win32" && command === "pnpm";
  const safeArgs = shell ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args;
  try {
    const output = execFileSync(command, safeArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell,
      timeout: 60_000,
      ...options,
    });
    return { ok: true, output, missing: false };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return {
      ok: false,
      output: output || String(error.message ?? error),
      missing: error.code === "ENOENT",
    };
  }
}

export function git(...args) {
  const result = run("git", args);
  return result.ok ? result.output.trim() : "";
}
