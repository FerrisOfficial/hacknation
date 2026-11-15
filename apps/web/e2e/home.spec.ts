import { expect, test } from "@playwright/test";

test("strona główna pokazuje formularz i waliduje pusty tekst", async ({ page }) => {
  // "/" przekierowuje na basePath (/hacknation) — test sprawdza też to przekierowanie.
  await page.goto("/");
  await expect(page).toHaveURL(/\/hacknation$/);
  await expect(page.getByRole("heading", { name: "hacknation" })).toBeVisible();

  await page.getByRole("button", { name: "Analizuj" }).click();
  await expect(page.getByText("Wpisz co najmniej 3 znaki")).toBeVisible();
});
