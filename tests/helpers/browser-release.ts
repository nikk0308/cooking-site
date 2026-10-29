import { buildSync } from "esbuild";
import { expect, type Page } from "@playwright/test";
export const bundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;
export async function snapshot(page: Page) {
  await page.addScriptTag({ content: bundle });
  return page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    try {
      const s = await repo.snapshot();
      return {
        recipes: s.recipes,
        favorites: s.favorites,
        shopping: s.shopping,
        photos: await Promise.all(
          s.photos.map(async (p) => ({
            id: p.id,
            recipeId: p.recipeId,
            type: p.blob.type,
            size: p.blob.size,
            sha256: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  await p.blob.arrayBuffer(),
                ),
              ),
              (b) => b.toString(16).padStart(2, "0"),
            ).join(""),
          })),
        ),
      };
    } finally {
      repo.close();
    }
  });
}
export async function exportFile(page: Page) {
  await page.goto("/my-recipes");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Экспортировать все личные данные",
      exact: true,
    })
    .click();
  const download = await pending;
  const stream = await download.createReadStream(),
    parts: Buffer[] = [];
  for await (const b of stream!) parts.push(b);
  return Buffer.concat(parts);
}
export async function importFile(page: Page, file: Buffer) {
  await page.goto("/my-recipes");
  await expect(
    page.getByLabel("Восстановить из backup JSON", { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Восстановить из backup JSON", { exact: true })
    .setInputFiles({
      name: "culinote-disposable.json",
      mimeType: "application/json",
      buffer: file,
    });
  await expect(
    page.getByRole("button", { name: "Подтвердить импорт", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Подтвердить импорт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Импорт завершён");
  await page.reload();
}
export async function login(page: Page) {
  await page.goto("/admin/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(process.env.E2E_ADMIN_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/recipes$/);
  await expect(
    page.getByRole("heading", { name: "Управление рецептами", exact: true }),
  ).toBeVisible();
  await page.waitForLoadState("load");
}
