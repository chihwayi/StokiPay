import { test, expect } from "@playwright/test";

test("PWA shell loads and shows sync status", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "StockFlow ZW" })).toBeVisible();
  await expect(page.getByText(/Online|Offline/)).toBeVisible();
});

test("manifest is served for installability", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.name).toBe("StockFlow ZW");
});
