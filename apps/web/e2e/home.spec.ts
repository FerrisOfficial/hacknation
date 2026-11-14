import { expect, test } from "@playwright/test";

test("strona główna pokazuje formularz i waliduje pusty tekst", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "hacknation" })).toBeVisible();

  await page.getByRole("button", { name: "Analizuj" }).click();
  await expect(page.getByText("Wpisz co najmniej 3 znaki")).toBeVisible();
});
