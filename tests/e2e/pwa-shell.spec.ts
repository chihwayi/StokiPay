import { test, expect } from "@playwright/test";

test("unauthenticated visitor is redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to StockFlow ZW" })).toBeVisible();
});

test("manifest is served for installability", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.name).toBe("StockFlow ZW");
});
