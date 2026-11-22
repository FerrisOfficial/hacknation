import { expect, test } from "@playwright/test";

test("strona główna to Przegląd z nawigacją", async ({ page }) => {
  // "/" przekierowuje na basePath (/hacknation), a tam od razu renderuje się Przegląd —
  // bez drugiego przekierowania, bo CI (job Docker Compose) wymaga 200 na /hacknation.
  await page.goto("/");
  await expect(page).toHaveURL(/\/hacknation\/?$/);
  await expect(page.getByRole("heading", { name: "Przegląd" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Główna" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Przegląd" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: /Kolejka/ }).first()).toBeVisible();
});
