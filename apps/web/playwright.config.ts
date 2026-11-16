import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Testy e2e lecą na zbudowanej aplikacji (pnpm build), na osobnym porcie niż `pnpm dev`.
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `http://localhost:${port}/hacknation/api/health`,
    reuseExistingServer: !process.env.CI,
  },
});
