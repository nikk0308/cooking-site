import { expect, test } from "@playwright/test";
import sharp from "sharp";
test("serves liveness", async ({ request }) => {
  const r = await request.get("/api/health/live");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: "ok" });
});
test("public catalog, scaling, nutrition and aggregated basket on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Рецепты", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "Сырники", exact: true }),
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Сырники", exact: true }),
  ).toBeVisible();
  await page.getByRole("spinbutton", { name: "Порции", exact: true }).fill("6");
  await expect(page.getByText("750 г", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "КБЖУ на порцию" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Добавлено");
  await page.goto("/recipes/omlet");
  await page
    .getByRole("button", { name: "В список продуктов", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Список продуктов", exact: true })
    .click();
  await expect(page.getByText("7 шт.", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Порции", exact: true })
    .first()
    .fill("4");
  await expect(page.getByText("6 шт.", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Порции", exact: true })
    .first()
    .fill("6");
  await expect(page.getByText("7 шт.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Удалить Омлет", exact: true })
    .click();
  await expect(page.getByText("3 шт.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Очистить список" }).click();
  await expect(page.getByText("Список пуст.", { exact: false })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("admin ingredient, draft, publication, media, editing and logout", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page
    .getByLabel("Email", { exact: true })
    .fill(process.env.E2E_ADMIN_EMAIL!);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("invalid-password-for-test");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Неверный");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/recipes$/);
  const session = (await page.context().cookies()).find(
    (c) => c.name === "recipes-admin",
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  await page.getByRole("link", { name: "Ингредиенты", exact: true }).click();
  await page
    .getByLabel("Название ингредиента", { exact: true })
    .first()
    .fill("Тестовый продукт");
  await page
    .getByLabel("Slug ингредиента", { exact: true })
    .first()
    .fill("test-product");
  await page
    .getByRole("button", { name: "Сохранить ингредиент", exact: true })
    .first()
    .click();
  await expect(page.locator("p[role=alert]").first()).toHaveText("Сохранено");
  await page.goto("/admin/recipes/new");
  await page.getByLabel("Название", { exact: true }).fill("Тестовый рецепт");
  await page.getByLabel("Slug", { exact: true }).fill("test-recipe");
  await page
    .getByRole("button", { name: "Добавить ингредиент", exact: true })
    .click();
  await page
    .getByLabel("Ингредиент", { exact: true })
    .selectOption({ label: "Тестовый продукт" });
  await page.getByLabel("Количество", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  await page
    .getByLabel("Инструкция", { exact: true })
    .fill("Смешайте ингредиенты.");
  await page
    .getByRole("button", { name: "Сохранить рецепт", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/recipes\/[a-f0-9-]+$/);
  await expect(
    page.getByRole("heading", { name: "Редактировать рецепт" }),
  ).toBeVisible();
  expect((await request.get("/recipes/test-recipe")).status()).toBe(404);
  const png = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#557755" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Загрузить фото").setInputFiles({
    name: "../../cover.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("status")).toContainText("Фото загружено");
  await page.getByLabel("Статус", { exact: true }).selectOption("PUBLISHED");
  await page
    .getByRole("button", { name: "Сохранить рецепт", exact: true })
    .click();
  await expect(page.locator("p[role=alert]")).toHaveText("Сохранено");
  const adminUrl = page.url();
  await page.goto("/recipes/test-recipe");
  await expect(
    page.getByRole("heading", { name: "Тестовый рецепт", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("КБЖУ рассчитано частично.", { exact: false }),
  ).toBeVisible();
  const image = page.getByRole("img", { name: "Тестовый рецепт", exact: true });
  const src = await image.getAttribute("src");
  expect(src).toMatch(/^\/media\/[a-f0-9-]+\.webp$/);
  expect((await request.get(src!)).status()).toBe(200);
  await page.goto(adminUrl);
  await page.getByLabel("Название", { exact: true }).fill("Изменённый рецепт");
  await page
    .getByRole("button", { name: "Сохранить рецепт", exact: true })
    .click();
  await expect(page.locator("p[role=alert]")).toHaveText("Сохранено");
  const invalid = await page.request.post("/api/admin/media", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: Buffer.from("<svg/>"),
  });
  expect(invalid.status()).toBe(400);
  const large = await page.request.post("/api/admin/media", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  expect(large.status()).toBe(400);
  const foreign = await page.request.post("/api/admin/recipes", {
    headers: { Origin: "https://evil.invalid" },
    data: {},
  });
  expect(foreign.status()).toBe(403);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/recipes");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
