import { expect, test } from "@playwright/test";

test("strona główna przenosi na Przegląd z nawigacją", async ({ page }) => {
  // "/" przekierowuje na basePath (/hacknation), a ten na Przegląd.
  await page.goto("/");
  await expect(page).toHaveURL(/\/hacknation\/przeglad$/);
  await expect(page.getByRole("heading", { name: "Przegląd" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Główna" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Kolejka/ }).first()).toBeVisible();
});
