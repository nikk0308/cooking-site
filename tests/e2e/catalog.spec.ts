import { test, expect, type Page } from "../helpers/playwright";
import { csvColumns } from "../../src/modules/catalog/import-format";
import { buildSync } from "esbuild";
const browserBundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;
async function login(page: Page) {
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
function envelope(id: string, name = `Synthetic browser ${id}`) {
  return {
    application: "culinote-catalog",
    schemaVersion: 1,
    namespace: "synthetic-browser-tests",
    records: [
      {
        externalId: id,
        name,
        slug: `browser-${id}`,
        category: null,
        aliases: [`alias-${id}`],
        nutrition: null,
      },
    ],
  };
}
async function upload(page: Page, value: unknown, name = "fixture.json") {
  await page.getByLabel("Файл каталога", { exact: true }).setInputFiles({
    name,
    mimeType: name.endsWith("csv") ? "text/csv" : "application/json",
    buffer: Buffer.from(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
  });
  await page
    .getByRole("button", { name: "Проверить файл — preview", exact: true })
    .click();
}
async function apply(page: Page) {
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Подтвердить импорт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Импорт сохранён");
}

test("imported catalog UUID flows through personal recipe and shopping without private writes", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("main")
    .getByRole("link", { name: "Импорт каталога", exact: true })
    .click();
  await upload(page, envelope("personal-shopping"));
  await apply(page);
  const item = (
    await (
      await page.request.get("/api/catalog?query=alias-personal-shopping")
    ).json()
  ).items[0];
  expect(item).toBeTruthy();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
  });
  await page.goto("/my-recipes/new");
  await page
    .getByLabel("Название", { exact: true })
    .fill("Private imported ingredient recipe");
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByText("Выбрать продукт из общего каталога", { exact: true })
    .click();
  await page
    .getByLabel("Запрос каталога", { exact: true })
    .fill("alias-personal-shopping");
  await page
    .getByRole("button", { name: "Найти в каталоге", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Выбрать ${item.name}`, exact: true })
    .click();
  await page.getByLabel("Количество 1", { exact: true }).fill("125.5");
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  await page
    .getByLabel("Шаг 1", { exact: true })
    .fill("Private test instruction");
  await page
    .getByRole("button", { name: "Сохранить личный рецепт", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Private imported ingredient recipe",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Добавлено в список продуктов" }),
  ).toHaveText("Добавлено в список продуктов");
  await page
    .getByRole("link", { name: "Список продуктов", exact: true })
    .click();
  const form = page.getByRole("form", {
    name: "Добавить вручную",
    exact: true,
  });
  await form
    .getByText("Выбрать продукт из общего каталога", { exact: true })
    .click();
  await form
    .getByLabel("Запрос каталога", { exact: true })
    .fill("alias-personal-shopping");
  await form
    .getByRole("button", { name: "Найти в каталоге", exact: true })
    .click();
  await form
    .getByRole("button", { name: `Выбрать ${item.name}`, exact: true })
    .click();
  await form.getByLabel("Количество продукта", { exact: true }).fill("1");
  await form
    .getByRole("button", { name: "Добавить продукт", exact: true })
    .click();
  await expect(
    form.getByLabel("Название продукта", { exact: true }),
  ).toHaveValue("");
  await page.addScriptTag({ content: browserBundle });
  const snapshot = await page.evaluate(async () => {
    const repo = await window.CulinoteFoundation.openBrowserRepository();
    try {
      return await repo.snapshot();
    } finally {
      repo.close();
    }
  });
  expect(snapshot.recipes[0].ingredients[0].product).toEqual({
    kind: "CATALOG",
    id: item.id,
  });
  expect(snapshot.shopping.manual[0].product).toEqual({
    kind: "CATALOG",
    id: item.id,
  });
  expect(writes).toEqual([]);
});

test("category and ingredient CRUD preserve legitimate nutrition and aliases; bounded recipe search keeps UUID", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("main")
    .getByRole("link", { name: "Категории", exact: true })
    .click();
  await page
    .getByLabel("Название категории", { exact: true })
    .fill("Браузерная тестовая категория");
  await page
    .getByLabel("Slug категории", { exact: true })
    .fill("browser-category");
  await page
    .getByRole("button", { name: "Сохранить категорию", exact: true })
    .click();
  await expect(page.locator("main p[role=alert]")).toContainText(
    "Категория сохранена",
  );
  await page
    .locator("main")
    .getByRole("link", { name: "Ингредиенты", exact: true })
    .click();
  await page
    .getByLabel("Название ингредиента", { exact: true })
    .fill("Браузерный тестовый продукт");
  await page
    .getByLabel("Slug ингредиента", { exact: true })
    .fill("browser-manual-product");
  await page
    .getByLabel("Категория", { exact: true })
    .selectOption({ label: "Браузерная тестовая категория" });
  await page
    .getByLabel("Синонимы — по одному на строку", { exact: true })
    .fill("Уникальный браузерный синоним");
  await page.getByLabel("Данные КБЖУ известны", { exact: true }).check();
  for (const label of [
    "Базовое количество",
    "Калории, ккал",
    "Белки, г",
    "Жиры, г",
    "Углеводы, г",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await page
    .getByLabel("Базовая единица", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Базовое количество", { exact: true }).fill("100");
  // Deliberately entered synthetic test values, never reference nutrition.
  await page.getByLabel("Калории, ккал", { exact: true }).fill("12.5");
  for (const label of ["Белки, г", "Жиры, г", "Углеводы, г"])
    await page.getByLabel(label, { exact: true }).fill("0");
  await page
    .getByLabel("Тип источника", { exact: true })
    .selectOption("MANUAL");
  await page
    .getByLabel("Источник данных", { exact: true })
    .fill("Synthetic browser fixture only");
  await page
    .getByRole("button", { name: "Сохранить ингредиент", exact: true })
    .click();
  await expect(page.locator("main p[role=alert]")).toHaveText("Сохранено");
  await page
    .getByLabel("Поиск по названию и синонимам", { exact: true })
    .fill("Уникальный браузерный синоним");
  await page
    .getByRole("button", { name: "Найти ингредиенты", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Браузерный тестовый продукт", exact: true })
    .click();
  const id = page.url().split("/").at(-1)!;
  await expect(page.getByLabel("Калории, ккал", { exact: true })).toHaveValue(
    "12.500000",
  );
  await page.getByLabel("Категория", { exact: true }).selectOption("");
  await page
    .getByRole("button", { name: "Сохранить ингредиент", exact: true })
    .click();
  await expect(page.locator("main p[role=alert]")).toHaveText("Сохранено");
  await page
    .locator("main")
    .getByRole("link", { name: "Ингредиенты", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Браузерный тестовый продукт", exact: true })
    .click();
  await expect(page.getByLabel("Категория", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Источник данных", { exact: true })).toHaveValue(
    "Synthetic browser fixture only",
  );
  await expect(page.getByLabel("Тип источника", { exact: true })).toHaveValue(
    "MANUAL",
  );
  await page
    .locator("main")
    .getByRole("link", { name: "Рецепты", exact: true })
    .click();
  await page.getByRole("link", { name: "Новый рецепт", exact: true }).click();
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByLabel("Поиск ингредиента", { exact: true })
    .fill("Уникальный браузерный синоним");
  await page
    .getByRole("button", { name: "Найти продукт", exact: true })
    .click();
  await page.getByLabel("Ингредиент", { exact: true }).selectOption(id);
  await expect(page.getByLabel("Ингредиент", { exact: true })).toHaveValue(id);
  await expect(
    page.getByLabel("Ингредиент", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByLabel("Поиск ингредиента", { exact: true })
    .nth(1)
    .fill("творог");
  await page
    .getByRole("button", { name: "Найти продукт", exact: true })
    .nth(1)
    .click();
  await page
    .getByLabel("Ингредиент", { exact: true })
    .nth(1)
    .selectOption({ label: "Творог (tvorog)" });
  const secondId = await page
    .getByLabel("Ингредиент", { exact: true })
    .nth(1)
    .inputValue();
  await page.getByRole("button", { name: "Ниже", exact: true }).first().click();
  await expect(
    page.getByLabel("Ингредиент", { exact: true }).nth(0),
  ).toHaveValue(secondId);
  await expect(
    page.getByLabel("Ингредиент", { exact: true }).nth(1),
  ).toHaveValue(id);
  await page
    .getByLabel("Название", { exact: true })
    .fill("Search selection reorder");
  await page
    .getByLabel("Slug", { exact: true })
    .fill("search-selection-reorder");
  await page
    .getByRole("button", { name: "Сохранить рецепт", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/recipes\/[a-f0-9-]{36}$/);
  await page.reload();
  await expect(
    page.getByLabel("Ингредиент", { exact: true }).nth(0),
  ).toHaveValue(secondId);
  await expect(
    page.getByLabel("Ингредиент", { exact: true }).nth(1),
  ).toHaveValue(id);
});

test("JSON preview, atomic apply, idempotent repeat, changed data, stale preview and retry", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("main")
    .getByRole("link", { name: "Импорт каталога", exact: true })
    .click();
  const data = envelope("json-cycle");
  await upload(page, data);
  await expect(page.getByRole("status")).toContainText("Каталог не изменён");
  expect(
    (
      await (
        await page.request.get("/api/catalog?query=alias-json-cycle")
      ).json()
    ).items,
  ).toHaveLength(0);
  await apply(page);
  const first = (
    await (await page.request.get("/api/catalog?query=alias-json-cycle")).json()
  ).items;
  expect(first).toHaveLength(1);
  await upload(page, data);
  await expect(page.locator("main")).toContainText("UNCHANGED: 1");
  await apply(page);
  const changed = envelope("json-cycle", "Changed synthetic browser product");
  await upload(page, changed);
  await expect(page.locator("main")).toContainText("UPDATE: 1");
  await apply(page);
  expect(
    (
      await (
        await page.request.get("/api/catalog?query=alias-json-cycle")
      ).json()
    ).items[0].id,
  ).toBe(first[0].id);
  const fresh = envelope("stale-browser");
  await upload(page, fresh);
  const response = await page.request.post("/api/admin/categories", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { name: "Stale plan category", slug: "stale-plan-category" },
  });
  expect(response.ok()).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Подтвердить импорт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("STALE_PLAN");
  expect(
    (
      await (
        await page.request.get("/api/catalog?query=alias-stale-browser")
      ).json()
    ).items,
  ).toHaveLength(0);
  await upload(page, fresh);
  await apply(page);
});

test("UTF8 CSV, conflicting manual mapping, malformed input, request failure and safe retry", async ({
  page,
}) => {
  await login(page);
  await page
    .locator("main")
    .getByRole("link", { name: "Импорт каталога", exact: true })
    .click();
  const csv =
    csvColumns.join(",") +
    '\r\n1,synthetic-browser-csv,csv-one,"Тестовый, продукт",browser-csv-one,,,"[""CSV alias""]",,,,,,,,,,\r\n';
  await upload(page, csv, "fixture.csv");
  await expect(page.locator("main")).toContainText("CREATE: 1");
  await apply(page);
  const manual = await page.request.post("/api/admin/ingredients", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      name: "Manual mapping candidate",
      slug: "manual-mapping-candidate",
    },
  });
  expect(manual.ok()).toBe(true);
  const conflicting = envelope("manual-link", "Manual mapping candidate");
  conflicting.records[0].externalId = "__proto__";
  await upload(page, conflicting);
  await expect(page.locator("main")).toContainText("CONFLICT: 1");
  await expect(
    page.getByRole("button", { name: "Подтвердить импорт", exact: true }),
  ).toBeDisabled();
  const select = page.getByLabel("Решение для __proto__", { exact: true });
  const option = await select
    .locator('option[value^="link:"]')
    .getAttribute("value");
  await select.selectOption(option!);
  await page
    .getByRole("button", { name: "Проверить файл — preview", exact: true })
    .click();
  await expect(select).toHaveValue(option!);
  await apply(page);
  await upload(page, "{bad json");
  await expect(page.getByRole("status")).toContainText("Не удалось разобрать");
  await upload(page, { ...envelope("future"), schemaVersion: 2 });
  await expect(page.getByRole("status")).toContainText(
    "Неподдерживаемый envelope",
  );
  const retry = envelope("network-retry");
  await upload(page, retry);
  await page.route(
    "**/api/admin/ingredients/import?format=json&action=apply",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic transaction failure" }),
      }),
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Подтвердить импорт", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Synthetic transaction failure",
  );
  expect(
    (
      await (
        await page.request.get("/api/catalog?query=alias-network-retry")
      ).json()
    ).items,
  ).toHaveLength(0);
  await page.unrouteAll();
  await upload(page, retry);
  await apply(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать отчёт о сохранении", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    "culinote-import-committed.csv",
  );
});

test("admin catalog mutations require session and origin; mobile import keyboard remains usable", async ({
  page,
}) => {
  for (const path of [
    "/api/admin/categories",
    "/api/admin/ingredients",
    "/api/admin/ingredients/import?format=json&action=preview",
    "/api/admin/ingredients/import?format=json&action=apply",
  ]) {
    expect(
      (
        await page.request.post(path, {
          headers: { Origin: "https://evil.example.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(path, {
          headers: { Origin: "http://127.0.0.1:3100" },
          data: {},
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(307);
  }
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("main")
    .getByRole("link", { name: "Импорт каталога", exact: true })
    .click();
  await upload(page, envelope("mobile-browser"));
  await expect(
    page.getByRole("button", { name: "Подтвердить импорт", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Подтвердить импорт", exact: true })
    .focus();
  await expect(
    page.getByRole("button", { name: "Подтвердить импорт", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
