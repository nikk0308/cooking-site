import { expect, test } from "@playwright/test";
test("renders the Russian foundation page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await expect(page.getByText("Основа проекта готова.")).toBeVisible();
  const imageUrl = await page.locator("img").getAttribute("src");
  expect(imageUrl).toContain("/_next/image");
  const imageResponse = await page.request.get(imageUrl!);
  expect(imageResponse.status()).toBe(200);
  expect(imageResponse.headers()["content-type"]).toMatch(/^image\//);
});
test("serves liveness without a database", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
