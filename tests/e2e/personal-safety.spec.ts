import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { localRecipe } from "../helpers/v02";

const bundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;

test("stale import preview and stale editor cannot overwrite another tab", async ({
  page,
  context,
}) => {
  await page.goto("/my-recipes");
  await page.addScriptTag({ content: bundle });
  const recipe = localRecipe();
  await page.evaluate(async (recipe) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.save(recipe);
    repo.close();
  }, recipe);
  await page.goto(`/my-recipes/${recipe.reference.id}/edit`);
  await page
    .getByLabel("Название", { exact: true })
    .fill("Несохранённая правка");
  const second = await context.newPage();
  await second.goto(`/my-recipes/${recipe.reference.id}/edit`);
  await second
    .getByLabel("Название", { exact: true })
    .fill("Правка другой вкладки");
  await second.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(
    second.getByRole("heading", { name: "Правка другой вкладки", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "другой вкладке",
  );
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Несохранённая правка",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Мои рецепты", exact: true }).click();
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const backup = await window.CulinoteFoundation.exportBrowserData(repo);
    const plan = await window.CulinoteFoundation.prepareImport(
      backup.blob,
      repo,
    );
    await repo.favorites.add((await repo.list())[0].reference);
    let code = "";
    try {
      await plan.confirm();
    } catch (e) {
      code = (e as { code: string }).code;
    }
    const data = await repo.snapshot();
    repo.close();
    return {
      code,
      title: data.recipes[0].title,
      favorites: data.favorites.items.length,
    };
  });
  expect(result).toEqual({
    code: "VERIFY_FAILED",
    title: "Правка другой вкладки",
    favorites: 1,
  });
});

test("unavailable IndexedDB has actionable UI and never looks like an empty library", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  await page.goto("/my-recipes");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Хранилище браузера недоступно" }),
  ).toBeVisible();
  await expect(page.getByText("Личных рецептов пока нет.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Повторить доступ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Экспортировать все личные данные" }),
  ).toBeDisabled();
});

test("corrupted and future records remain intact and block incomplete export", async ({
  page,
}) => {
  await page.goto("/my-recipes");
  await expect(page.getByText("Личных рецептов пока нет.")).toBeVisible();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async (recipe) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("culinote-browser", 2);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("recipes", "readwrite");
        tx.objectStore("recipes").put({ ...recipe, schemaVersion: 99 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  }, localRecipe());
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "более новой версией",
  );
  await page
    .getByRole("button", { name: "Экспортировать все личные данные" })
    .click();
  await expect(page.locator("main").getByRole("alert").last()).toContainText(
    "более новой версией",
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("culinote-browser");
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("recipes", "readwrite"),
          s = tx.objectStore("recipes"),
          get = s.getAll();
        get.onsuccess = () => {
          if (get.result[0].schemaVersion !== 99) throw Error("Data lost");
          s.put({ ...get.result[0], schemaVersion: 1, title: null });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "повреждённые данные",
  );
  await expect(page.getByText("Личных рецептов пока нет.")).toHaveCount(0);
});

test("invalid image and invalid quantity keep editor state; back cancellation keeps draft", async ({
  page,
}) => {
  await page.goto("/my-recipes");
  await page.getByRole("link", { name: "Создать рецепт", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Не терять черновик");
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Ингредиент 1", exact: true })
    .fill("Личный продукт");
  await page.getByLabel("Количество 1", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "Сохранить личный рецепт" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "положительные",
  );
  await page.getByLabel("Добавить фотографии").setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(
      "Сохраняется только в этом браузере. Есть несохранённые изменения.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Описание фото 1")).toHaveCount(0);
  const dialog = page.waitForEvent("dialog");
  await page.evaluate(() => history.back());
  await (await dialog).dismiss();
  await expect(page).toHaveURL(/\/my-recipes\/new$/);
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Не терять черновик",
  );
});

test("SSR favorites stay disabled until delayed JavaScript hydrates", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/**/*.js*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const button = page.getByRole("button", {
    name: "В избранное: Сырники",
    exact: true,
  });
  await expect(button).toBeDisabled();
  release();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByRole("button", {
      name: "Убрать из избранного: Сырники",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("missing owned Blob blocks editor and complete export without stripping metadata", async ({
  page,
}) => {
  await page.goto("/my-recipes");
  await expect(page.getByText("Личных рецептов пока нет.")).toBeVisible();
  const recipe = localRecipe();
  recipe.photos = [
    { kind: "LOCAL", id: crypto.randomUUID(), alt: "Недостающий Blob" },
  ];
  await page.evaluate(async (recipe) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("culinote-browser");
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("recipes", "readwrite");
        tx.objectStore("recipes").put(recipe);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
  }, recipe);
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "повреждённые данные",
  );
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await page
    .getByRole("button", { name: "Экспортировать все личные данные" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Резервная копия личных данных" })
      .getByRole("alert"),
  ).toContainText("повреждённые данные");
  expect(downloads).toBe(0);
  await page.goto(`/my-recipes/${recipe.reference.id}/edit`);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "повреждённые данные",
  );
  await expect(page.getByLabel("Название", { exact: true })).toHaveCount(0);
  await page.addScriptTag({ content: bundle });
  expect(
    await page.evaluate(async (id) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      const r = await repo.get(id);
      repo.close();
      return r;
    }, recipe.reference.id),
  ).toEqual(recipe);
});
