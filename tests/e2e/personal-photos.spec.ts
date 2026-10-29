import { expect, test } from "../helpers/playwright";
import sharp from "sharp";
import { buildSync } from "esbuild";
const bundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;

test("photo replacement/reordering stays transactional and releases display URLs", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const active = new Set<string>(),
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    Object.assign(window, { photoUrls: active });
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      active.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      active.delete(url);
      revoke(url);
    };
  });
  await page.goto("/my-recipes/new");
  await page.getByLabel("Название", { exact: true }).fill("Фото и порядок");
  const a = await sharp({
    create: { width: 20, height: 15, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const b = await sharp({
    create: { width: 30, height: 25, channels: 3, background: "blue" },
  })
    .webp()
    .toBuffer();
  await page.getByLabel("Добавить фотографии").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: a },
    { name: "b.webp", mimeType: "image/webp", buffer: b },
  ]);
  await page.getByLabel("Описание фото 1").fill("Красный");
  await page.getByLabel("Описание фото 2").fill("Синий");
  await page.getByRole("button", { name: "Фото 2 вверх", exact: true }).click();
  await expect(page.getByLabel("Описание фото 1")).toHaveValue("Синий");
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  await page.getByLabel("Шаг 1", { exact: true }).fill("Первый");
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  await page.getByLabel("Шаг 2", { exact: true }).fill("Второй");
  await page.getByRole("button", { name: "Шаг 2 вверх", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(
    page.getByRole("heading", { name: "Фото и порядок", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ content: bundle });
  const before = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const r = (await repo.list())[0];
    repo.close();
    return r;
  });
  expect(before.steps.map((s) => s.instruction)).toEqual(["Второй", "Первый"]);
  await page.getByRole("link", { name: "Редактировать", exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить фото 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(
    page.getByRole("heading", { name: "Фото и порядок", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ content: bundle });
  const after = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const data = await repo.snapshot();
    repo.close();
    return { recipe: data.recipes[0], photos: data.photos.map((p) => p.id) };
  });
  expect(after.recipe.steps).toEqual(before.steps);
  expect(after.photos).toEqual([before.photos[1].id]);
  expect(after.recipe.photos[0].alt).toBe("Красный");
  await page.getByRole("link", { name: "Избранное", exact: true }).click();
  await expect(page.getByText("В избранном пока нет рецептов.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { photoUrls: Set<string> }).photoUrls.size,
      ),
    )
    .toBe(0);
});
