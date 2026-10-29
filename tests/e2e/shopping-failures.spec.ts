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
const id = localRecipe().reference.id;
const source = JSON.stringify({
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
async function read(page: Page) {
  await page.addScriptTag({ content: bundle });
  return page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const d = await repo.shopping.get();
    repo.close();
    return d;
  });
}
async function setup(page: Page) {
  await page.goto("/basket");
  await expect(
    page.getByRole("heading", { name: "Добавить вручную", exact: true }),
  ).toBeVisible();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(
    async ({ source, id }) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      await repo.shopping.update((d) => ({
        ...d,
        recipes: [
          {
            id,
            reference: { kind: "LOCAL", id },
            selectedServings: 2,
            addedAt: "2026-10-28T00:00:00Z",
          },
        ],
        manual: [
          {
            id: crypto.randomUUID(),
            product: { kind: "LOCAL", id: crypto.randomUUID() },
            name: "Не потерять",
            quantity: "2",
            unit: {
              code: "g",
              name: "грамм",
              symbol: "г",
              dimension: "MASS",
              factorToBase: "1",
            },
          },
        ],
        overrides: [{ id: "preserved", purchased: true, quantity: "10" }],
      }));
      localStorage.setItem("recipes:basket:v1", source);
      repo.close();
    },
    { source, id },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Найдена старая корзина v1" }),
  ).toBeVisible();
}

for (const phase of ["first", "verification"] as const)
  for (const failure of ["QuotaExceededError", "AbortError"] as const) {
    test(`legacy ${phase} ${failure}: rollback/resume preserves source and previously saved v2`, async ({
      page,
    }) => {
      await setup(page);
      const before = await read(page);
      await page.evaluate(
        ({ phase, failure }) => {
          const original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (value, ...args) {
            if (
              this.name === "documents" &&
              value.key === "migration:basket:v1" &&
              !!value.value.verified === (phase === "verification")
            ) {
              IDBObjectStore.prototype.put = original;
              if (failure === "AbortError") this.transaction.abort();
              throw new DOMException("Isolated test failure", failure);
            }
            return original.call(this, value, ...args);
          };
        },
        { phase, failure },
      );
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Подтвердить перенос v1" })
        .click();
      await expect(
        page
          .getByRole("region", { name: "Перенос старой корзины" })
          .getByRole("alert"),
      ).toBeVisible();
      const after = await read(page);
      expect(after.manual).toEqual(before.manual);
      expect(after.overrides).toEqual(before.overrides);
      expect(after.recipes[0]).toEqual(before.recipes[0]);
      expect(after.recipes).toHaveLength(phase === "first" ? 1 : 2);
      expect(
        await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
      ).toBe(source);
      // Reload after the interrupted transaction must show a resumable preview,
      // never automatically reapply or clear either version.
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Подтвердить перенос v1" }),
      ).toBeVisible();
      expect(await read(page)).toEqual(after);
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Подтвердить перенос v1" })
        .click();
      await expect(
        page.getByRole("button", { name: "Подтвердить перенос v1" }),
      ).toHaveCount(0);
      const migrated = await read(page);
      expect(migrated.recipes).toHaveLength(2);
      expect(
        migrated.recipes.find((r) => r.reference.kind === "PUBLIC"),
      ).toMatchObject({
        reference: { kind: "PUBLIC", id },
        selectedServings: 6,
      });
      expect(migrated.manual).toEqual(before.manual);
      expect(migrated.overrides).toEqual(before.overrides);
      await page.addScriptTag({ content: bundle });
      expect(
        await page.evaluate(async () => {
          const repo = await window.CulinoteFoundation.openBrowserRepository();
          const result = await repo.migrateBasket();
          repo.close();
          return result;
        }),
      ).toBe("ALREADY_MIGRATED");
      expect(await read(page)).toEqual(migrated);
    });
  }

test("source changed during confirmation invalidates the preview; stale reconciliation cannot overwrite v2", async ({
  page,
  context,
}) => {
  await setup(page);
  const before = await read(page),
    old = await context.newPage();
  await old.goto("/");
  const changed = source.replace(
    '"selectedServings":6',
    '"selectedServings":8',
  );
  page.once("dialog", async (d) => {
    await old.evaluate(
      (raw) => localStorage.setItem("recipes:basket:v1", raw),
      changed,
    );
    await d.accept();
  });
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page
      .getByRole("region", { name: "Перенос старой корзины" })
      .getByRole("alert"),
  ).toBeVisible();
  expect(await read(page)).toEqual(before);
  await page.getByRole("button", { name: "Повторить предпросмотр v1" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toHaveCount(0);
  await page.addScriptTag({ content: bundle });
  const outcome = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    localStorage.setItem(
      "recipes:basket:v1",
      localStorage
        .getItem("recipes:basket:v1")!
        .replace('"selectedServings":8', '"selectedServings":10'),
    );
    const preview = await repo.legacyPreview();
    await repo.shopping.update((d) => ({
      ...d,
      overrides: [
        ...d.overrides,
        { id: "newer-tab", quantity: null, purchased: true },
      ],
    }));
    const before = await repo.shopping.get();
    let code = "";
    try {
      await repo.reconcileLegacy(preview, {
        [preview.shopping.recipes.find((r) => r.reference.kind === "PUBLIC")!
          .reference.id]: "V1",
      });
    } catch (e) {
      code = (e as { code: string }).code;
    }
    const after = await repo.shopping.get();
    repo.close();
    return { code, before, after };
  });
  expect(outcome.code).toBe("VERIFY_FAILED");
  expect(outcome.after).toEqual(outcome.before);
});

for (const raw of ["not-json", '{"schemaVersion":99,"items":[]}']) {
  test(`malformed/unsupported legacy is preserved: ${raw}`, async ({
    page,
  }) => {
    await page.goto("/basket");
    await expect(
      page.getByRole("heading", { name: "Добавить вручную", exact: true }),
    ).toBeVisible();
    await page.evaluate(
      (raw) => localStorage.setItem("recipes:basket:v1", raw),
      raw,
    );
    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "Перенос старой корзины" })
        .getByRole("alert"),
    ).toContainText("неподдерживаемую версию");
    await expect(page.getByText("Список пуст.", { exact: false })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
    ).toBe(raw);
    expect((await read(page)).recipes).toEqual([]);
  });
}

test("denied legacy storage does not clear or block existing IndexedDB shopping", async ({
  page,
}) => {
  await page.addInitScript((source) => {
    localStorage.setItem("recipes:basket:v1", source);
    const original = Storage.prototype.getItem;
    Object.assign(window, {
      restoreLegacyRead: () => {
        Storage.prototype.getItem = original;
      },
    });
    Storage.prototype.getItem = function (key) {
      if (key === "recipes:basket:v1")
        throw new DOMException("Denied in isolated test", "SecurityError");
      return original.call(this, key);
    };
  }, source);
  await page.goto("/basket");
  await expect(
    page
      .getByRole("region", { name: "Перенос старой корзины" })
      .getByRole("alert"),
  ).toContainText("не удалось прочитать");
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form
    .getByLabel("Название продукта", { exact: true })
    .fill("Работает v2");
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Куплено: Работает v2", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { restoreLegacyRead: () => void }
    ).restoreLegacyRead(),
  );
  expect(
    await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
  ).toBe(source);
  expect((await read(page)).manual[0].name).toBe("Работает v2");
});

test("shopping quota failures revert pending marks, preserve manual draft and roll back clear checkpoint", async ({
  page,
}) => {
  await page.goto("/basket");
  await expect(
    page.getByRole("heading", { name: "Добавить вручную", exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form.getByLabel("Название продукта", { exact: true }).fill("Оригинал");
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Куплено: Оригинал", exact: true }),
  ).toBeVisible();
  const before = await read(page);
  const fail = (key: string) =>
    page.evaluate((key) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === "documents" && value.key === key) {
          IDBObjectStore.prototype.put = put;
          throw new DOMException("Isolated quota", "QuotaExceededError");
        }
        return put.call(this, value, ...args);
      };
    }, key);
  await fail("shopping");
  await page
    .getByRole("checkbox", { name: "Куплено: Оригинал", exact: true })
    .click();
  await expect(
    page
      .locator("main")
      .getByRole("alert")
      .filter({ hasText: "недостаточно места" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Куплено: Оригинал", exact: true }),
  ).not.toBeChecked();
  expect(await read(page)).toEqual(before);
  await form.getByLabel("Название продукта", { exact: true }).fill("Черновик");
  await fail("shopping");
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveValue("Черновик");
  expect(await read(page)).toEqual(before);
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Куплено: Черновик", exact: true }),
  ).toBeVisible();
  const after = await read(page);
  await fail("shopping:undo");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Очистить список", exact: true })
    .click();
  await expect(
    page
      .locator("main")
      .getByRole("alert")
      .filter({ hasText: "недостаточно места" }),
  ).toBeVisible();
  expect(await read(page)).toEqual(after);
  await expect(page.getByText("Список пуст.", { exact: false })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Отменить последнее удаление или очистку",
    }),
  ).toBeDisabled();
});

test("losing IndexedDB during editing retains the draft and flags the last loaded view", async ({
  page,
}) => {
  await page.goto("/basket");
  await expect(
    page.getByRole("heading", { name: "Добавить вручную", exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form
    .getByLabel("Название продукта", { exact: true })
    .fill("Черновик при недоступном IDB");
  const before = await read(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    Object.assign(window, {
      restoreShoppingDatabase: () => {
        IDBDatabase.prototype.transaction = original;
      },
    });
    IDBDatabase.prototype.transaction = function () {
      throw new DOMException(
        "Isolated unavailable database",
        "InvalidStateError",
      );
    };
  });
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    page.getByText("Показано последнее загруженное состояние", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveValue("Черновик при недоступном IDB");
  await expect(
    form.getByRole("button", { name: "Добавить продукт", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (
      window as unknown as { restoreShoppingDatabase: () => void }
    ).restoreShoppingDatabase(),
  );
  expect(await read(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Обновить список", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Добавить продукт", exact: true }),
  ).toBeEnabled();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveValue("Черновик при недоступном IDB");
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: "Куплено: Черновик при недоступном IDB",
      exact: true,
    }),
  ).toBeVisible();
});

test("a disappearing source cannot report verified reconciliation or bypass a captured-source gate", async ({
  page,
  context,
}) => {
  await setup(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByRole("button", { name: "Подтвердить перенос v1" }),
  ).toHaveCount(0);
  await page.addScriptTag({ content: bundle });
  const gate = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository(),
      p = await repo.legacyPreview(),
      before = await repo.shopping.get();
    let code = "";
    try {
      await repo.migrateBasket(
        { getItem: () => null },
        { raw: p.raw!, revision: p.revision },
      );
    } catch (e) {
      code = (e as { code: string }).code;
    }
    const after = await repo.shopping.get();
    repo.close();
    return { code, before, after };
  });
  expect(gate.code).toBe("VERIFY_FAILED");
  expect(gate.after).toEqual(gate.before);
  const old = await context.newPage();
  await old.goto("/");
  const changed = source.replace(
    '"selectedServings":6',
    '"selectedServings":8',
  );
  await old.evaluate(
    (raw) => localStorage.setItem("recipes:basket:v1", raw),
    changed,
  );
  await page.getByLabel(`Порции для ${id}`).selectOption("V1");
  // Simulate an independent legacy writer removing v1 after the source check,
  // as the cross-storage transaction cannot lock localStorage.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (
        this.name === "documents" &&
        value.key === "migration:basket:v1" &&
        !value.value.verified
      ) {
        IDBObjectStore.prototype.put = put;
        localStorage.removeItem("recipes:basket:v1");
      }
      return put.call(this, value, ...args);
    };
  });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Подтвердить перенос v1" }).click();
  await expect(
    page.getByText("Источник v1 исчез во время операции.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Перенос проверен.", { exact: false }),
  ).toHaveCount(0);
  await page.addScriptTag({ content: bundle });
  const p = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    const p = await repo.legacyPreview();
    repo.close();
    return p;
  });
  expect(p.receipt).toMatchObject({
    raw: changed,
    originalRaw: source,
    verified: false,
  });
  expect(
    p.shopping.recipes.find((r) => r.reference.kind === "PUBLIC")
      ?.selectedServings,
  ).toBe(8);
});
