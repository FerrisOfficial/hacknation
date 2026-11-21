// Tworzy brakujące pliki .env z wzorów .env.example. Wszystko działa lokalnie (baza w Dockerze),
// więc wzory mają gotowe wartości — po `pnpm install` nic nie trzeba uzupełniać.
// Istniejących plików nie rusza. Uruchamia się samo po `pnpm install` i przy `pnpm dev`.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  { example: ".env.example", target: ".env" },
  { example: "apps/web/.env.example", target: "apps/web/.env.local" },
  { example: "packages/db/.env.example", target: "packages/db/.env" },
];

for (const { example, target } of files) {
  const from = join(root, example);
  const to = join(root, target);
  if (!existsSync(to) && existsSync(from)) {
    copyFileSync(from, to);
    console.log(`Utworzono ${target} z ${example}`);
  }
}
