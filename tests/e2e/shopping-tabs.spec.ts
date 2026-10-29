import { expect, test } from "../helpers/playwright";
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

test("concurrent tabs retain portions, purchased state and manual additions; imported shopping broadcasts", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  await page.goto("/my-recipes");
  await page.addScriptTag({ content: bundle });
  const recipe = localRecipe();
  await page.evaluate(async (r) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.save(r);
    repo.close();
  }, recipe);
  await page.goto(`/my-recipes/${recipe.reference.id}`);
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Добавлено");
  await page.goto("/basket");
  await expect(page.getByText("500 г", { exact: true })).toBeVisible();
  const second = await context.newPage(),
    third = await context.newPage();
  await Promise.all([second.goto("/basket"), third.goto("/basket")]);
  await expect(
    second.getByRole("checkbox", { name: "Куплено: Творог", exact: true }),
  ).toBeVisible();
  const form = third.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form
    .getByLabel("Название продукта", { exact: true })
    .fill("Другая вкладка");
  await Promise.all([
    page
      .locator(`[data-reference="LOCAL:${recipe.reference.id}"]`)
      .getByRole("spinbutton")
      .fill("6"),
    second
      .getByRole("checkbox", { name: "Куплено: Творог", exact: true })
      .check(),
    form.getByRole("button", { name: "Добавить продукт", exact: true }).click(),
  ]);
  for (const tab of [page, second, third]) {
    await expect(tab.getByText("750 г", { exact: true })).toBeVisible();
    await expect(
      tab.getByRole("checkbox", { name: "Куплено: Творог", exact: true }),
    ).toBeChecked();
    await expect(
      tab.getByRole("checkbox", {
        name: "Куплено: Другая вкладка",
        exact: true,
      }),
    ).toBeVisible();
  }
  const portions = page
    .locator(`[data-reference="LOCAL:${recipe.reference.id}"]`)
    .getByRole("spinbutton");
  await portions.fill("1");
  await portions.pressSequentially("2");
  await expect(portions).toHaveValue("12");
  await expect(second.getByText("1.5 кг", { exact: true })).toBeVisible();
  await portions.fill("6");
  await expect(second.getByText("750 г", { exact: true })).toBeVisible();
  const firstCurd = page.locator("li[data-shopping-id]").filter({
    has: page.getByRole("checkbox", { name: "Куплено: Творог", exact: true }),
  });
  await firstCurd
    .getByText("Изменить количество: Творог", { exact: true })
    .click();
  await firstCurd.getByLabel("Новое количество для Творог (г)").fill("900");
  const curd = third.locator("li[data-shopping-id]").filter({
    has: third.getByRole("checkbox", {
      name: "Куплено: Творог",
      exact: true,
    }),
  });
  await curd.getByText("Изменить количество: Творог", { exact: true }).click();
  await curd.getByLabel("Новое количество для Творог (г)").fill("800");
  await curd
    .getByRole("button", { name: "Изменить количество", exact: true })
    .click();
  await expect(page.getByText("800 г", { exact: true })).toBeVisible();
  await expect(
    firstCurd.getByLabel("Новое количество для Творог (г)"),
  ).toHaveValue("900");
  await page.addScriptTag({ content: bundle });
  const exported = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const shopping = await repo.shopping.get(),
      file = await window.CulinoteFoundation.exportBrowserData(repo);
    const data = await file.blob.text();
    repo.close();
    return { shopping, data };
  });
  second.once("dialog", (d) => d.accept());
  await second
    .getByRole("button", { name: "Очистить список", exact: true })
    .click();
  await expect(third.getByText("Список пуст.", { exact: false })).toBeVisible();
  await page.goto("/my-recipes");
  await expect(page.getByLabel("Восстановить из backup JSON")).toBeEnabled();
  await page.getByLabel("Восстановить из backup JSON").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported.data),
  });
  await expect(
    page.getByRole("heading", { name: "Предпросмотр импорта" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Подтвердить импорт" }).click();
  await expect(page.getByRole("status")).toContainText("Импорт завершён");
  await expect(
    third.getByRole("checkbox", { name: "Куплено: Творог", exact: true }),
  ).toBeChecked();
  await expect(third.getByText("800 г", { exact: true })).toBeVisible();
  await third.reload();
  await third.addScriptTag({ content: bundle });
  expect(
    await third.evaluate(async () => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      const d = await repo.shopping.get();
      repo.close();
      return d;
    }),
  ).toEqual(exported.shopping);
});

test("shopping controls wait for delayed JavaScript and retain stored state", async ({
  page,
}) => {
  await page.goto("/basket");
  await expect(
    page.getByRole("heading", { name: "Добавить вручную", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.shopping.update((d) => ({
      ...d,
      manual: [
        {
          id: crypto.randomUUID(),
          product: { kind: "LOCAL", id: crypto.randomUUID() },
          name: "Сохранённый продукт",
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
    repo.close();
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto("/basket", { waitUntil: "commit" });
    await expect(
      page.getByRole("button", { name: "Обновить список", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Очистить список", exact: true }),
    ).toHaveCount(0);
    release();
    await expect(
      page.getByRole("checkbox", {
        name: "Куплено: Сохранённый продукт",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "Куплено: Сохранённый продукт",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("checkbox", {
        name: "Куплено: Сохранённый продукт",
        exact: true,
      }),
    ).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: "Куплено: Сохранённый продукт",
        exact: true,
      }),
    ).toBeChecked();
  } finally {
    release();
  }
});
