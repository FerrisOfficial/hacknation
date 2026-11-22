// Lokalny stan hooków (ignorowany przez git): kiedy ostatnio przeszedł `pnpm check`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const DIR = join(ROOT, ".claude", "state");
const FILE = join(DIR, "ostatni-check.json");

export function lastCheckAt() {
  if (!existsSync(FILE)) return 0;
  try {
    return Number(JSON.parse(readFileSync(FILE, "utf8")).at) || 0;
  } catch {
    return 0;
  }
}

export function saveCheck(at = Date.now()) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify({ at, iso: new Date(at).toISOString() })}\n`);
}
