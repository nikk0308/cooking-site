import { expect, test, type Page } from "../helpers/playwright";
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
async function api(page: Page) {
  await page.addScriptTag({ content: bundle });
}
async function shopping(page: Page) {
  await api(page);
  return page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const d = await repo.shopping.get();
    repo.close();
    return d;
  });
}
async function openList(page: Page) {
  await page.goto("/basket");
  await expect(
    page.getByRole("heading", { name: "Добавить вручную", exact: true }),
  ).toBeVisible();
}
async function addManual(page: Page, name: string, amount = "1") {
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form.getByLabel("Название продукта", { exact: true }).fill(name);
  await form.getByLabel("Количество продукта", { exact: true }).fill(amount);
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveValue("");
}
const product = (page: Page, name: string) =>
  page.locator("li[data-shopping-id]").filter({
    has: page.getByRole("checkbox", {
      name: `Куплено: ${name}`,
      exact: true,
    }),
  });

test("PUBLIC/LOCAL additions use selected servings, deduplicate and aggregate; mobile purchase and overrides", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) outbound.push(r.url());
  });
  await page.goto("/recipes/syrniki");
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("6");
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Добавлено");
  const first = await shopping(page),
    id = first.recipes[0].reference.id,
    rowId = first.recipes[0].id;
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("4");
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Порции в списке обновлены",
  );
  expect((await shopping(page)).recipes).toMatchObject([
    { id: rowId, selectedServings: 4 },
  ]);
  const publicDoc = (
    await (await page.request.get(`/api/recipes/resolve?id=${id}`)).json()
  ).recipes[0];
  await api(page);
  await page.evaluate(async (recipe) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.save({
      ...recipe,
      reference: { kind: "LOCAL", id: recipe.reference.id },
      slug: null,
      title: "Личный двойник",
      photos: [],
    });
    repo.close();
  }, publicDoc);
  await page.goto(`/my-recipes/${id}`);
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("2");
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Добавлено");
  await openList(page);
  await expect(page.getByText("750 г", { exact: true })).toBeVisible();
  expect((await shopping(page)).recipes).toHaveLength(2);
  const curd = product(page, "Творог"),
    derivedId = await curd.getAttribute("data-shopping-id");
  await curd.getByRole("checkbox").check();
  await curd.getByText("Изменить количество: Творог", { exact: true }).click();
  await curd.getByLabel("Новое количество для Творог (г)").fill("800");
  await curd
    .getByRole("button", { name: "Изменить количество", exact: true })
    .click();
  await expect(curd.getByText("800 г", { exact: true })).toBeVisible();
  const publicRow = page.locator(`[data-reference="PUBLIC:${id}"]`);
  await publicRow.getByRole("spinbutton").fill("6");
  await expect(
    curd.getByText("Расчётное количество: 1000 г", { exact: false }),
  ).toBeVisible();
  await expect(curd.getByText("800 г", { exact: true })).toBeVisible();
  await page.reload();
  await expect(product(page, "Творог").getByRole("checkbox")).toBeChecked();
  await product(page, "Творог")
    .getByText("Изменить количество: Творог", { exact: true })
    .click();
  await product(page, "Творог")
    .getByRole("button", { name: "Вернуть расчётное количество" })
    .click();
  await expect(
    product(page, "Творог").getByText("1 кг", { exact: true }),
  ).toBeVisible();
  await publicRow.getByRole("spinbutton").fill("4");
  await expect(
    product(page, "Творог").getByText("750 г", { exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form
    .getByText("Выбрать продукт из общего каталога", { exact: true })
    .click();
  await form.getByLabel("Запрос каталога").fill("творог");
  await form.getByLabel("Запрос каталога").press("Enter");
  await form
    .getByRole("button", { name: "Выбрать Творог", exact: true })
    .click();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveJSProperty("readOnly", true);
  await form.getByLabel("Количество продукта", { exact: true }).fill("0.25");
  await form
    .getByLabel("Единица продукта")
    .selectOption({ label: "килограмм (кг)" });
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    product(page, "Творог").getByText("1 кг", { exact: true }),
  ).toBeVisible();
  expect(await product(page, "Творог").getAttribute("data-shopping-id")).toBe(
    derivedId,
  );
  await expect(product(page, "Творог").getByRole("checkbox")).toBeChecked();
  await page
    .getByRole("button", { name: "Поднять Личный двойник", exact: true })
    .click();
  expect(await product(page, "Творог").getAttribute("data-shopping-id")).toBe(
    derivedId,
  );
  await page
    .getByRole("button", { name: "Удалить Сырники", exact: true })
    .click();
  await expect(
    product(page, "Творог").getByText("500 г", { exact: true }),
  ).toBeVisible();
  await expect(product(page, "Творог").getByRole("checkbox")).toBeChecked();
  const catalogRow = (await shopping(page)).manual[0];
  const manual = page.locator(`[data-manual-id="${catalogRow.id}"]`);
  await manual
    .getByRole("button", { name: "Редактировать Творог", exact: true })
    .click();
  await manual
    .getByRole("button", { name: "Сделать личным продуктом", exact: true })
    .click();
  await manual
    .getByLabel("Название продукта", { exact: true })
    .fill("Свободный продукт");
  await manual
    .getByRole("button", { name: "Сохранить продукт", exact: true })
    .click();
  await expect(product(page, "Свободный продукт")).toBeVisible();
  const detached = (await shopping(page)).manual[0];
  expect(detached).toEqual({
    ...catalogRow,
    name: "Свободный продукт",
    product: detached.product,
  });
  expect(detached.product.kind).toBe("LOCAL");
  expect(detached.product.id).not.toBe(catalogRow.product.id);
  await expect(
    product(page, "Свободный продукт").getByRole("checkbox"),
  ).not.toBeChecked();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Снять отметки куплено", exact: true })
    .click();
  await expect(product(page, "Творог").getByRole("checkbox")).not.toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
  ).toBeNull();
  expect(outbound).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("manual identity, exact decimals, incompatible and CUSTOM rows; explicit edits and orphan retirement", async ({
  page,
}) => {
  await openList(page);
  await addManual(page, "Молоко", "0.123456789012345678901234");
  await addManual(page, "Молоко", "2");
  const before = await shopping(page);
  expect(before.manual).toHaveLength(2);
  expect(before.manual[0].product.id).not.toBe(before.manual[1].product.id);
  await expect(product(page, "Молоко")).toHaveCount(2);
  const row = page.locator(`[data-manual-id="${before.manual[0].id}"]`);
  await row
    .getByRole("button", { name: "Редактировать Молоко", exact: true })
    .click();
  await row
    .getByLabel("Название продукта", { exact: true })
    .fill("Личное молоко");
  await row
    .getByRole("button", { name: "Сохранить продукт", exact: true })
    .click();
  await expect(
    row.getByRole("button", {
      name: "Редактировать Личное молоко",
      exact: true,
    }),
  ).toBeVisible();
  const renamed = (await shopping(page)).manual[0];
  expect(renamed).toEqual({ ...before.manual[0], name: "Личное молоко" });
  await product(page, "Личное молоко").getByRole("checkbox").check();
  await page
    .getByRole("checkbox", { name: "Скрыть купленные", exact: true })
    .check();
  await expect(product(page, "Личное молоко")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Скрыть купленные", exact: true })
    .uncheck();
  await expect(
    product(page, "Личное молоко").getByRole("checkbox"),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Удалить ручной Личное молоко", exact: true })
    .click();
  await expect(product(page, "Личное молоко")).toHaveCount(0);
  expect((await shopping(page)).overrides).toEqual([]);
  // Re-adding the same canonical product after its last source disappeared must
  // not inherit the retired purchased state.
  await api(page);
  await page.evaluate(async (row) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.shopping.update((d) => ({
      ...d,
      manual: [...d.manual, { ...row, id: crypto.randomUUID() }],
    }));
    repo.close();
  }, renamed);
  await page.reload();
  await expect(
    product(page, "Личное молоко").getByRole("checkbox"),
  ).not.toBeChecked();
  await api(page);
  await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const d = await repo.shopping.get(),
      original = d.manual[0];
    const custom = {
      code: "pinch",
      name: "щепотка",
      symbol: "щеп.",
      dimension: "CUSTOM" as const,
      factorToBase: null,
    };
    await repo.shopping.update((current) => ({
      ...current,
      manual: [
        ...current.manual,
        ...[
          custom,
          custom,
          {
            code: "ml",
            name: "миллилитр",
            symbol: "мл",
            dimension: "VOLUME" as const,
            factorToBase: "1",
          },
        ].map((unit) => ({ ...original, id: crypto.randomUUID(), unit })),
      ],
    }));
    repo.close();
  });
  await page.reload();
  await expect(product(page, "Молоко")).toHaveCount(4);
  await expect(
    page.getByText("Разные размерности — учтены отдельно, без плотности.", {
      exact: true,
    }),
  ).toHaveCount(4);
});

test("clear confirmation, persistent guarded undo and portable shopping roundtrip preserve personal data", async ({
  page,
}) => {
  await openList(page);
  await addManual(page, "Backup продукт", "0.123456");
  await product(page, "Backup продукт").getByRole("checkbox").check();
  await product(page, "Backup продукт")
    .getByText("Изменить количество: Backup продукт", { exact: true })
    .click();
  await product(page, "Backup продукт")
    .getByLabel("Новое количество для Backup продукт (г)")
    .fill("5");
  await product(page, "Backup продукт")
    .getByRole("button", { name: "Изменить количество", exact: true })
    .click();
  await api(page);
  await page.evaluate(async (r) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    await repo.save(r);
    await repo.favorites.add(r.reference);
    localStorage.setItem("recipes:basket:v1", '{"schemaVersion":1,"items":[]}');
    repo.close();
  }, localRecipe());
  await page.reload();
  const before = await shopping(page);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Очистить список", exact: true })
    .click();
  expect(await shopping(page)).toEqual(before);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Очистить список", exact: true })
    .click();
  await expect(page.getByText("Список пуст.", { exact: false })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Отменить последнее удаление или очистку" })
    .click();
  await expect(
    product(page, "Backup продукт").getByText("5 г", { exact: true }),
  ).toBeVisible();
  expect(await shopping(page)).toEqual(before);
  await api(page);
  const result = await page.evaluate(async () => {
    const api = window.CulinoteFoundation,
      repo = await api.openBrowserRepository(),
      exported = await api.exportBrowserData(repo);
    const other = await api.openBrowserRepository("portable-shopping-isolated"),
      plan = await api.prepareImport(exported.blob, other);
    await plan.confirm();
    const restored = await other.shopping.get(),
      favorites = await repo.favorites.list(),
      recipe = await repo.get(favorites.items[0].id);
    other.close();
    repo.close();
    return { restored, recipe: !!recipe, favorites: favorites.items.length };
  });
  expect(result).toEqual({ restored: before, recipe: true, favorites: 1 });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Очистить список", exact: true })
    .click();
  await expect(page.getByText("Список пуст.", { exact: false })).toBeVisible();
  await addManual(page, "Новые данные");
  await expect(
    page.getByRole("button", {
      name: "Отменить последнее удаление или очистку",
    }),
  ).toBeDisabled();
  await api(page);
  const code = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    try {
      await repo.shopping.undo();
    } catch (e) {
      repo.close();
      return (e as { code: string }).code;
    }
    repo.close();
    return "unexpected";
  });
  expect(code).toBe("VERIFY_FAILED");
  expect((await shopping(page)).manual[0].name).toBe("Новые данные");
  expect(
    await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
  ).toBe('{"schemaVersion":1,"items":[]}');
});

test("legacy preview transfers v1 safely and reconciles changed servings explicitly across tabs", async ({
  page,
  context,
}) => {
  await openList(page);
  await addManual(page, "Сохранить ручной");
  const id = localRecipe().reference.id;
  const raw = JSON.stringify({
    schemaVersion: 1,
    items: [
      {
        schemaVersion: 1,
        recipeId: id,
        selectedServings: 6,
        addedAt: "2026-10-28T00:00:00Z",
      },
    ],
  });
  await api(page);
  await page.evaluate(
    async ({ raw, id }) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      await repo.shopping.update((d) => ({
        ...d,
        recipes: [
          {
            id: crypto.randomUUID(),
            reference: { kind: "PUBLIC", id },
            selectedServings: 2,
            addedAt: "2026-10-28T00:00:00Z",
          },
          {
            id: crypto.randomUUID(),
            reference: { kind: "LOCAL", id },
            selectedServings: 3,
            addedAt: "2026-10-28T00:00:00Z",
          },
        ],
        overrides: [{ id: "keep-override", purchased: true, quantity: "10" }],
      }));
      localStorage.setItem("recipes:basket:v1", raw);
      repo.close();
    },
    { raw, id },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Найдена старая корзина v1" }),
  ).toBeVisible();
  await expect(
    page.getByText("сохранятся порции v2", { exact: false }),
  ).toBeVisible();
  const before = await shopping(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByText("Перенос проверен.", { exact: false }),
  ).toBeVisible();
  expect(await shopping(page)).toEqual(before);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toHaveCount(0);
  const oldTab = await context.newPage();
  await oldTab.goto("/");
  const changed = raw.replace('"selectedServings":6', '"selectedServings":8');
  await oldTab.evaluate(
    (raw) => localStorage.setItem("recipes:basket:v1", raw),
    changed,
  );
  await expect(
    page.getByRole("heading", {
      name: "Старая корзина изменилась — требуется согласование",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toBeDisabled();
  await page.getByLabel(`Порции для ${id}`).selectOption("V2");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toHaveCount(0);
  expect(await shopping(page)).toEqual(before);
  const newer = changed.replace(
    '"selectedServings":8',
    '"selectedServings":10',
  );
  await oldTab.evaluate(
    (raw) => localStorage.setItem("recipes:basket:v1", raw),
    newer,
  );
  await expect(page.getByLabel(`Порции для ${id}`)).toBeVisible();
  await page.getByLabel(`Порции для ${id}`).selectOption("V1");
  await oldTab.goto("/basket");
  await oldTab
    .locator(`[data-reference="PUBLIC:${id}"]`)
    .getByRole("spinbutton")
    .fill("12");
  await expect(page.getByLabel(`Порции для ${id}`)).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toBeDisabled();
  await expect(
    page
      .getByLabel(`Порции для ${id}`)
      .getByRole("option", { name: "Оставить v2: 12", exact: true }),
  ).toHaveCount(1);
  await page.getByLabel(`Порции для ${id}`).selectOption("V1");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toHaveCount(0);
  const after = await shopping(page);
  expect(after.recipes).toEqual(
    before.recipes.map((r) =>
      r.reference.kind === "PUBLIC" ? { ...r, selectedServings: 10 } : r,
    ),
  );
  expect(after.manual).toEqual(before.manual);
  expect(after.overrides).toEqual(before.overrides);
  await api(page);
  expect(
    await page.evaluate(async () => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      const p = await repo.legacyPreview();
      repo.close();
      return p.receipt?.originalRaw;
    }),
  ).toBe(raw);
  expect(
    await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
  ).toBe(newer);
});

test("network and unavailable recipes never disappear or present falsely complete totals", async ({
  page,
}) => {
  await page.goto("/recipes/syrniki");
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Добавлено");
  const before = await shopping(page);
  await page.route("**/api/recipes/resolve?*", (route) => route.abort());
  await openList(page);
  await expect(
    page.getByText("Временно не удалось загрузить рецепт", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Неполный список:", { exact: false }),
  ).toBeVisible();
  expect(await shopping(page)).toEqual(before);
  await page.unroute("**/api/recipes/resolve?*");
  await page.route("**/api/recipes/resolve?*", (route) =>
    route.fulfill({ json: { recipes: [] } }),
  );
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    page.getByText("Рецепт недоступен", { exact: true }),
  ).toBeVisible();
  expect(await shopping(page)).toEqual(before);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Удалить Рецепт недоступен", exact: true })
    .click();
  await expect(page.getByText("Список пуст.", { exact: false })).toBeVisible();
  expect((await shopping(page)).recipes).toEqual([]);
});

test("older CUSTOM settings remain visible and exportable without rebinding to an uncertain unit", async ({
  page,
}) => {
  await openList(page);
  await api(page);
  const fixture = localRecipe();
  fixture.ingredients[0].unit = {
    code: "pinch",
    name: "щепотка",
    symbol: "щеп.",
    dimension: "CUSTOM",
    factorToBase: null,
  };
  const oldKey = `CATALOG:${fixture.ingredients[0].product.id}:LOCAL:${fixture.reference.id}:${fixture.ingredients[0].id}:CUSTOM`;
  await page.evaluate(
    async ({ fixture, oldKey }) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      await repo.save(fixture);
      await repo.shopping.update((d) => ({
        ...d,
        recipes: [
          {
            id: crypto.randomUUID(),
            reference: fixture.reference,
            selectedServings: 4,
            addedAt: "2026-10-28T00:00:00Z",
          },
        ],
        overrides: [{ id: oldKey, purchased: true, quantity: "9" }],
      }));
      repo.close();
    },
    { fixture, oldKey },
  );
  await page.reload();
  await page
    .getByText("Сохранённые неприменённые настройки: 1", { exact: true })
    .click();
  await expect(
    page.getByText("куплено; ручное количество: 9", { exact: false }),
  ).toBeVisible();
  await expect(product(page, "Творог").getByRole("checkbox")).not.toBeChecked();
  await expect(
    product(page, "Творог").getByText("500 щеп.", { exact: true }),
  ).toBeVisible();
  expect((await shopping(page)).overrides).toEqual([
    { id: oldKey, purchased: true, quantity: "9" },
  ]);
  await api(page);
  expect(
    await page.evaluate(async () => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      const exported = await window.CulinoteFoundation.exportBrowserData(repo);
      const json = JSON.parse(await exported.blob.text());
      repo.close();
      return json.shopping.overrides;
    }),
  ).toEqual([{ id: oldKey, purchased: true, quantity: "9" }]);
});
