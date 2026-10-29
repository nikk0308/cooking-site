import { expect, test, type Page } from "../helpers/playwright";
import sharp from "sharp";
import { buildSync } from "esbuild";
import type * as Foundation from "../../src/platform/browser/foundation";
declare global {
  interface Window {
    CulinoteFoundation: typeof Foundation;
  }
}
const bundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;
const png = () =>
  sharp({
    create: { width: 24, height: 20, channels: 3, background: "#558855" },
  })
    .png()
    .toBuffer();
async function api(page: Page) {
  await page.addScriptTag({ content: bundle });
}
async function create(page: Page, title = "Личные сырники") {
  await page.goto("/my-recipes/new");
  await page.getByLabel("Название", { exact: true }).fill(title);
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Ингредиент 1", exact: true })
    .fill("Творог");
  await page.getByLabel("Количество 1", { exact: true }).fill("500");
  await page.getByLabel("Группа 1").fill("Основа");
  await page.getByLabel("Примечание 1").fill("Мой личный секрет");
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  await page.getByLabel("Шаг 1", { exact: true }).fill("Смешайте ингредиенты.");
  await page.getByLabel("Добавить фотографии").setInputFiles({
    name: "personal.png",
    mimeType: "image/png",
    buffer: await png(),
  });
  await page.getByLabel("Описание фото 1").fill("Моя личная фотография");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}
async function exportFile(page: Page) {
  await page.goto("/my-recipes");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать все личные данные" })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^culinote-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const stream = await file.createReadStream(),
    parts = [];
  for await (const chunk of stream!) parts.push(chunk);
  return Buffer.concat(parts);
}
async function chooseImport(page: Page, buffer: Buffer) {
  await page.getByLabel("Восстановить из backup JSON").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer,
  });
}
async function snapshot(page: Page) {
  await api(page);
  return page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const data = await repo.snapshot();
    repo.close();
    return {
      recipes: data.recipes,
      photos: data.photos.map((p) => ({
        id: p.id,
        recipeId: p.recipeId,
        size: p.blob.size,
      })),
      favorites: data.favorites,
      shopping: data.shopping,
    };
  });
}

test("mobile personal CRUD, real photos, catalog nutrition, favorites and guarded navigation", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  page.on("pageerror", (e) => console.error("BROWSER ERROR", e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  const writes: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  const id = await create(page);
  await expect(
    page.getByText("КБЖУ рассчитано частично", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Моя личная фотография" })
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(24);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Личные сырники", exact: true }),
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("6");
  await expect(page.getByText("750 г", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "В избранное: Личные сырники", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Убрать из избранного: Личные сырники" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("750 г", { exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("4");
  await expect(page.getByText("500 г", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Редактировать", exact: true }).click();
  await page
    .getByLabel("Описание", { exact: true })
    .fill("Изменённое личное описание");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Мои рецепты", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${id}/edit$`));
  await expect(
    page.getByRole("textbox", { name: "Описание", exact: true }),
  ).toHaveValue("Изменённое личное описание");
  await page
    .getByText("Выбрать продукт из общего каталога", { exact: true })
    .click();
  await page.getByLabel("Запрос каталога").fill("творог");
  await page.getByRole("button", { name: "Найти в каталоге" }).click();
  await page
    .getByRole("button", { name: "Выбрать Творог", exact: true })
    .click();
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(page.getByText("Изменённое личное описание")).toBeVisible();
  await expect(
    page.getByText("КБЖУ рассчитано частично", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "Моя личная фотография" }),
  ).toBeVisible();
  const original = await snapshot(page);
  await page.getByRole("button", { name: "Дублировать", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Личные сырники (копия)", exact: true }),
  ).toBeVisible();
  const copied = await snapshot(page);
  expect(copied.recipes).toHaveLength(2);
  expect(copied.photos).toHaveLength(2);
  expect(copied.photos[0].id).not.toBe(copied.photos[1].id);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page).toHaveURL(/\/my-recipes$/);
  await expect(
    page.getByRole("heading", { name: "Личные сырники", exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).photos).toEqual(original.photos);
  await page.goto("/favorites");
  await expect(
    page.getByRole("heading", { name: "Личные сырники", exact: true }),
  ).toBeVisible();
  const second = await context.newPage();
  await second.goto(`/my-recipes/${id}`);
  await second
    .getByRole("button", { name: "Убрать из избранного: Личные сырники" })
    .click();
  await expect(page.getByText("В избранном пока нет рецептов.")).toBeVisible();
  await second.close();
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Мои рецепты", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Избранное", exact: true }),
  ).toBeFocused();
});

test("complete portable backup, isolated restore, repeated import and non-destructive failure cases", async ({
  page,
}) => {
  test.setTimeout(120000);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  const id = await create(page, "Переносимый рецепт");
  await api(page);
  await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.favorites.add({
      kind: "LOCAL",
      id: (await repo.list())[0].reference.id,
    });
    await repo.shopping.update((d) => ({
      ...d,
      manual: [
        {
          id: crypto.randomUUID(),
          product: { kind: "LOCAL", id: crypto.randomUUID() },
          name: "Личный продукт",
          quantity: "0.123456",
          unit: {
            code: "g",
            name: "грамм",
            symbol: "г",
            dimension: "MASS",
            factorToBase: "1",
          },
        },
      ],
    }));
    localStorage.setItem("recipes:basket:v1", '{"schemaVersion":1,"items":[]}');
    localStorage.setItem("unrelated-token", "DO_NOT_EXPORT_THIS");
    repo.close();
  });
  const file = await exportFile(page),
    parsed = JSON.parse(file.toString());
  expect(file.toString()).not.toContain("DO_NOT_EXPORT_THIS");
  expect(file.toString()).not.toContain("recipes:basket:v1");
  expect(parsed.recipes[0].reference.id).toBe(id);
  expect(Buffer.from(parsed.photos[0].data, "base64")).toEqual(await png());
  const before = await snapshot(page);
  // Disposable Playwright context only, never a persistent user profile.
  await page.evaluate(async () => {
    if (location.origin !== "http://127.0.0.1:3100")
      throw new Error("Unsafe test origin");
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("culinote-browser");
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction(["recipes", "photos", "documents"], "readwrite");
        for (const s of ["recipes", "photos", "documents"])
          tx.objectStore(s).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await expect(page.getByText("Личных рецептов пока нет.")).toBeVisible();
  await chooseImport(page, file);
  await expect(
    page.getByText("Новых рецептов: 1", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "photos") {
        IDBObjectStore.prototype.add = original;
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "недостаточно места",
  );
  expect((await snapshot(page)).recipes).toHaveLength(0);
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(page.getByRole("status")).toContainText("Импорт завершён");
  await page.reload();
  expect(await snapshot(page)).toEqual(before);
  await chooseImport(page, file);
  await expect(
    page.getByText("Идентичных рецептов пропущено: 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(page.getByRole("status")).toContainText("Импорт завершён");
  expect(await snapshot(page)).toEqual(before);
  const conflict = structuredClone(parsed);
  conflict.recipes[0].title = "Не перезаписывать";
  await chooseImport(page, Buffer.from(JSON.stringify(conflict)));
  await expect(
    page.getByRole("button", { name: "Подтвердить импорт" }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
  const corrupt = structuredClone(parsed);
  corrupt.photos[0].data = "PHN2Zy8+";
  await chooseImport(page, Buffer.from(JSON.stringify(corrupt)));
  await expect(page.locator("main").getByRole("alert")).toContainText("фото");
  expect(await snapshot(page)).toEqual(before);
  const shop = structuredClone(parsed);
  shop.shopping.manual[0].quantity = "9";
  await chooseImport(page, Buffer.from(JSON.stringify(shop)));
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "список покупок отличается",
  );
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
  ).toBe('{"schemaVersion":1,"items":[]}');
  expect(writes).toEqual([]);
});

test("PUBLIC and LOCAL UUID collision, temporary public resolver errors and unavailable favorites", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const card = page.locator("article.card").filter({
    has: page.getByRole("heading", { name: "Сырники", exact: true }),
  });
  const href = await card.getByRole("link").getAttribute("href");
  expect(href).toBe("/recipes/syrniki");
  await card
    .getByRole("button", { name: "В избранное: Сырники", exact: true })
    .click();
  await page.goto("/favorites");
  await expect(
    page.getByRole("heading", { name: "Сырники", exact: true }),
  ).toBeVisible();
  const data = await (
    await request.get(
      "/api/recipes/resolve?id=" + (await snapshot(page)).favorites.items[0].id,
    )
  ).json();
  const id = data.recipes[0].reference.id;
  await api(page);
  await page.evaluate(
    async ({ recipe, id }) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      await repo.save({
        ...recipe,
        reference: { kind: "LOCAL", id },
        slug: null,
        title: "Личный с тем же UUID",
        photos: [],
      });
      await repo.favorites.add({ kind: "LOCAL", id });
      repo.close();
    },
    { recipe: data.recipes[0], id },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Личный с тем же UUID", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Сырники", exact: true }),
  ).toBeVisible();
  await page.route("**/api/recipes/resolve?*", (route) => route.abort());
  await page.getByRole("button", { name: "Обновить избранное" }).click();
  await expect(
    page.getByRole("heading", { name: "Временно не удалось загрузить рецепт" }),
  ).toBeVisible();
  expect((await snapshot(page)).favorites.items).toHaveLength(2);
  await page.unroute("**/api/recipes/resolve?*");
  await page.getByRole("button", { name: "Обновить избранное" }).click();
  await expect(
    page.getByRole("heading", { name: "Сырники", exact: true }),
  ).toBeVisible();
  await api(page);
  await page.evaluate(async (id) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.delete(id);
    repo.close();
  }, id);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Личный рецепт удалён или недоступен" }),
  ).toBeVisible();
  expect((await snapshot(page)).favorites.items).toHaveLength(2);
  await page.getByRole("button", { name: "Убрать недоступный рецепт" }).click();
  await expect(
    page.getByRole("heading", { name: "Личный рецепт удалён или недоступен" }),
  ).toHaveCount(0);
});

test("public resolution is bounded and has no mutation path; drafts stay hidden", async ({
  request,
}) => {
  expect(
    (await request.get("/api/recipes/resolve?id=LOCAL:not-uuid")).status(),
  ).toBe(400);
  const ids = Array.from({ length: 101 }, () => ["id", crypto.randomUUID()]);
  expect(
    (
      await request.get(`/api/recipes/resolve?${new URLSearchParams(ids)}`)
    ).status(),
  ).toBe(400);
  expect(
    (await request.post("/api/recipes/resolve", { data: {} })).status(),
  ).toBe(405);
  expect(
    (await request.get("/api/catalog?query=" + "a".repeat(101))).status(),
  ).toBe(400);
  const origin = { Origin: "http://127.0.0.1:3100" };
  expect(
    (
      await request.post("/api/admin/login", {
        headers: origin,
        data: {
          email: process.env.E2E_ADMIN_EMAIL,
          password: process.env.E2E_ADMIN_PASSWORD,
        },
      })
    ).ok(),
  ).toBe(true);
  const input = {
    title: "Скрытый fixture",
    slug: "hidden-portability-fixture",
    status: "DRAFT",
    baseServings: 4,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    ingredients: [],
    steps: [],
  };
  const saved = await request.post("/api/admin/recipes", {
    headers: origin,
    data: input,
  });
  expect(saved.ok()).toBe(true);
  const { id } = await saved.json();
  expect(
    await (await request.get(`/api/recipes/resolve?id=${id}`)).json(),
  ).toEqual({ recipes: [] });
  expect(
    (
      await request.post("/api/admin/recipes", {
        headers: origin,
        data: { ...input, id, status: "ARCHIVED" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    await (await request.get(`/api/recipes/resolve?id=${id}`)).json(),
  ).toEqual({ recipes: [] });
});
