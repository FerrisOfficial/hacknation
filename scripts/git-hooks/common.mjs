// Wspólne funkcje git hooków (.githooks/). Hooki są w Node, żeby działały tak samo na Windowsie
// (Git for Windows uruchamia .githooks przez własne sh) i na macOS/Linuksie.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Uruchamia polecenie z wyjściem na terminal. Zwraca true, gdy kod wyjścia = 0.
 * Brak narzędzia w PATH (np. uv) to ostrzeżenie, nie blokada — ten krok i tak sprawdza CI.
 */
export function step(label, command, args) {
  process.stdout.write(`› ${label}\n`);
  const shell = process.platform === "win32" && command === "pnpm";
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", shell });
  if (result.error?.code === "ENOENT") {
    process.stdout.write(`  ⚠ pominięto: brak \`${command}\` w PATH (sprawdzi CI)\n`);
    return true;
  }
  return result.status === 0;
}

export function git(...args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function fail(message) {
  process.stderr.write(`\n✖ ${message}\n`);
  process.exit(1);
}
