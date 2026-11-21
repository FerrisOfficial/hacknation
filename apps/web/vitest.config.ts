import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Ten sam alias co w tsconfig.json (`@/*` → `src/*`).
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
