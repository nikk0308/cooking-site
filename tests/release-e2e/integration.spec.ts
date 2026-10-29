import { test, expect, browserProfile, type Page } from "../helpers/playwright";
import sharp from "sharp";
import { releaseDiagnostics } from "../helpers/release-diagnostics";
import {
  login,
  snapshot,
  exportFile,
  importFile,
} from "../helpers/browser-release";
import { csvColumns } from "../../src/modules/catalog/import-format";

test("admin/catalog/public/private/favorites/shopping/photo backup restore integrate without private writes", async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(180000); // One 20-stage integration journey; no sleeps/retries.
  const diagnostics = releaseDiagnostics(test.info());
  diagnostics.watch("admin", admin);
  let visitor: Awaited<ReturnType<typeof browserProfile>> | undefined;
  let restoredContext: Awaited<ReturnType<typeof browserProfile>> | undefined;
  let failed = true;
  const writes: string[] = [];
  const track = (label: string, p: Page) => {
    diagnostics.watch(label, p);
    p.on("request", (r) => {
      if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
      expect(r.url()).not.toContain("PRIVATE_RELEASE");
    });
  };
  const step = diagnostics.step;
  try {
    const { origin, headers, category } = await step(
      "01 Admin login / category",
      async () => {
        await login(admin);
        const origin = "http://127.0.0.1:3100",
          headers = { Origin: origin };
        const category = {
          name: "Синтетическая интеграция",
          slug: "release-integration",
        };
        expect(
          (
            await admin.request.post("/api/admin/categories", {
              headers,
              data: category,
            })
          ).ok(),
        ).toBe(true);

        return { origin, headers, category };
      },
    );
    const { productName, alias, record, envelope, ingredientId } = await step(
      "02 Catalog import",
      async () => {
        const productName = "Синтетический продукт интеграции",
          alias = "release-shared-ingredient";
        const record = {
          externalId: "fixture-1",
          name: productName,
          slug: "release-shared-product",
          category,
          aliases: [alias],
          nutrition: {
            basisQuantity: "100",
            basisUnit: "g",
            caloriesKcal: "70",
            proteinG: "10",
            fatG: "2",
            carbohydratesG: "3",
            sourceKind: "IMPORT",
            sourceNote:
              "Synthetic expected-value fixture; not real reference food",
            sourceUrl: "https://example.invalid/synthetic",
            sourceIdentifier: "release-fixture:1",
          },
        };
        const envelope = {
          application: "culinote-catalog",
          schemaVersion: 1,
          namespace: "synthetic-release-journey",
          records: [record],
        };
        const initial = Buffer.from(JSON.stringify(envelope));
        const preview = await admin.request.post(
          "/api/admin/ingredients/import?format=json&action=preview",
          { headers, data: initial },
        );
        expect(preview.ok()).toBe(true);
        const plan = await preview.json();
        expect(plan.counts.CREATE).toBe(1);
        const ingredientId = plan.rows[0].ingredientId as string;
        expect(
          (
            await admin.request.post(
              "/api/admin/ingredients/import?format=json&action=apply",
              {
                headers: { ...headers, "X-Catalog-Plan": plan.hash },
                data: initial,
              },
            )
          ).ok(),
        ).toBe(true);

        return { productName, alias, record, envelope, ingredientId };
      },
    );
    const { png, recipe, publicId } = await step(
      "03 Media / public recipe creation",
      async () => {
        const png = await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#558855" },
        })
          .png()
          .toBuffer();
        const upload = await admin.request.post("/api/admin/media", {
          headers,
          data: png,
        });
        expect(upload.ok()).toBe(true);
        const cover = (await upload.json()).id;
        const recipe = {
          title: "Публичная интеграция",
          slug: "release-public-integration",
          description: "Synthetic public data",
          baseServings: 4,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          status: "PUBLISHED",
          coverMediaId: cover,
          ingredients: [
            {
              ingredientId,
              quantity: "500",
              unitId: "10000000-0000-4000-8000-000000000001",
              groupLabel: "Основа",
              note: "",
            },
          ],
          steps: ["Синтетический шаг"],
        };
        const saved = await admin.request.post("/api/admin/recipes", {
          headers,
          data: recipe,
        });
        expect(saved.ok()).toBe(true);
        const publicId = (await saved.json()).id;
        // Next dev compiles a newly published dynamic URL on first access. Finish
        // that request before any visitor page subscribes to HMR reload events.
        const published = await admin.request.get(`/recipes/${recipe.slug}`);
        expect(published.status()).toBe(200);
        await published.body();

        return { png, recipe, publicId };
      },
    );
    const page = await step("04 Public browsing / scaling", async () => {
      visitor = await browserProfile(browser);
      await diagnostics.anonymousContext("visitor", visitor);
      const page = await visitor.newPage();
      track("visitor", page);
      await page.goto(`${origin}/recipes/${recipe.slug}`);
      await expect(
        page.getByRole("img", { name: recipe.title, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("spinbutton", { name: "Порции", exact: true })
        .fill("6");
      await expect(page.getByText("750 г", { exact: true })).toBeVisible();

      return page;
    });
    await step("05 Public favorites / shopping additions", async () => {
      await page
        .getByRole("button", {
          name: `В избранное: ${recipe.title}`,
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "В список продуктов", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "Добавлено" }),
      ).toContainText("Добавлено");
    });
    await step(
      "06 Personal recipe / photograph / local additions",
      async () => {
        await page
          .getByRole("link", { name: "Мои рецепты", exact: true })
          .click();
        await page
          .getByRole("link", { name: "Создать рецепт", exact: true })
          .click();
        await page
          .getByLabel("Название", { exact: true })
          .fill("PRIVATE_RELEASE_LOCAL");
        await page.getByLabel("Количество порций", { exact: true }).fill("2");
        await page
          .getByRole("button", { name: "Добавить ингредиент", exact: true })
          .click();
        await page
          .getByText("Выбрать продукт из общего каталога", { exact: true })
          .click();
        await page.getByLabel("Запрос каталога", { exact: true }).fill(alias);
        await page
          .getByRole("button", { name: "Найти в каталоге", exact: true })
          .click();
        await page
          .getByRole("button", { name: `Выбрать ${productName}`, exact: true })
          .click();
        await page.getByLabel("Количество 1", { exact: true }).fill("100");
        await page
          .getByRole("button", { name: "Добавить шаг", exact: true })
          .click();
        await page
          .getByLabel("Шаг 1", { exact: true })
          .fill("PRIVATE_RELEASE_STEP");
        await page.getByLabel("Добавить фотографии").setInputFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: png,
        });
        await page
          .getByLabel("Описание фото 1")
          .fill("Синтетическая личная фотография");
        await page
          .getByRole("button", { name: "Сохранить личный рецепт", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "PRIVATE_RELEASE_LOCAL",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", {
            name: "В избранное: PRIVATE_RELEASE_LOCAL",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "В список продуктов", exact: true })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "Добавлено" }),
        ).toContainText("Добавлено");
      },
    );
    const before = await step(
      "07 Shopping aggregation / overrides",
      async () => {
        await page
          .getByRole("link", { name: "Список продуктов", exact: true })
          .click();
        const item = page.locator("li[data-shopping-id]").filter({
          has: page.getByRole("checkbox", {
            name: `Куплено: ${productName}`,
            exact: true,
          }),
        });
        await expect(item.getByText("850 г", { exact: true })).toBeVisible();
        await item.getByRole("checkbox").check();
        await item
          .getByText(`Изменить количество: ${productName}`, { exact: true })
          .click();
        await item
          .getByLabel(`Новое количество для ${productName} (г)`, {
            exact: true,
          })
          .fill("900");
        await item
          .getByRole("button", { name: "Изменить количество", exact: true })
          .click();
        const manual = page.getByRole("form", {
          name: "Добавить вручную",
          exact: true,
        });
        await manual
          .getByLabel("Название продукта", { exact: true })
          .fill("PRIVATE_RELEASE_MANUAL");
        await manual
          .getByLabel("Количество продукта", { exact: true })
          .fill("0.125");
        await manual
          .getByRole("button", { name: "Добавить продукт", exact: true })
          .click();
        await expect(
          manual.getByLabel("Название продукта", { exact: true }),
        ).toHaveValue("");
        await page.reload();
        await expect(item.getByRole("checkbox")).toBeChecked();
        await expect(item.getByText("900 г", { exact: true })).toBeVisible();
        const before = await snapshot(page);
        expect(before.shopping.recipes).toHaveLength(2);
        expect(before.favorites.items).toHaveLength(2);
        expect(before.recipes[0].ingredients[0].product).toEqual({
          kind: "CATALOG",
          id: ingredientId,
        });

        return before;
      },
    );
    const file = await step("08 Export browser data", async () => {
      const file = await exportFile(page);
      expect(JSON.parse(file.toString()).photos).toHaveLength(1);

      return file;
    });
    const restored = await step("09 Import into second profile", async () => {
      restoredContext = await browserProfile(browser);
      await diagnostics.anonymousContext("restored", restoredContext);
      const restored = await restoredContext.newPage();
      track("restored", restored);
      await restored.goto(origin + "/my-recipes");
      await importFile(restored, file);
      expect(await snapshot(restored)).toEqual(before);

      return restored;
    });
    await step(
      "10 Photo verification / corrupt import preservation",
      async () => {
        await restored.goto(
          `${origin}/my-recipes/${before.recipes[0].reference.id}`,
        );
        await expect
          .poll(() =>
            restored
              .getByRole("img", {
                name: "Синтетическая личная фотография",
                exact: true,
              })
              .evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBe(16);
        await restored
          .getByRole("link", { name: "Мои рецепты", exact: true })
          .click();
        const corrupt = { ...JSON.parse(file.toString()), schemaVersion: 99 };
        await expect(
          restored.getByLabel("Восстановить из backup JSON", { exact: true }),
        ).toBeEnabled();
        await restored
          .getByLabel("Восстановить из backup JSON", { exact: true })
          .setInputFiles({
            name: "future.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(corrupt)),
          });
        await expect(restored.locator("main").getByRole("alert")).toBeVisible();
        expect(await snapshot(restored)).toEqual(before);
      },
    );
    await step("11 Catalog update / publication restrictions", async () => {
      // CSV updates the same SOURCE identity; no new product or recipe FK.
      const values = [
        "1",
        envelope.namespace,
        record.externalId,
        record.name,
        record.slug,
        category.slug,
        category.name,
        JSON.stringify(record.aliases),
        "100",
        "g",
        "71",
        "10",
        "2",
        "3",
        "IMPORT",
        record.nutrition.sourceNote,
        record.nutrition.sourceUrl,
        record.nutrition.sourceIdentifier,
      ];
      const cell = (v: string) => '"' + v.replaceAll('"', '""') + '"',
        csv = Buffer.from(
          csvColumns.join(",") + "\r\n" + values.map(cell).join(",") + "\r\n",
        );
      const updated = await (
        await admin.request.post(
          "/api/admin/ingredients/import?format=csv&action=preview",
          { headers, data: csv },
        )
      ).json();
      expect(updated.counts.UPDATE).toBe(1);
      expect(updated.rows[0].ingredientId).toBe(ingredientId);
      expect(
        (
          await admin.request.post(
            "/api/admin/ingredients/import?format=csv&action=apply",
            {
              headers: { ...headers, "X-Catalog-Plan": updated.hash },
              data: csv,
            },
          )
        ).ok(),
      ).toBe(true);
      const document = (
        await (
          await admin.request.get(`/api/recipes/resolve?id=${publicId}`)
        ).json()
      ).recipes[0];
      expect(document.ingredients[0].product.id).toBe(ingredientId);
      expect(document.ingredients[0].nutrition.caloriesKcal).toBe("71.000000");
      for (const status of ["DRAFT", "ARCHIVED"]) {
        expect(
          (
            await admin.request.post("/api/admin/recipes", {
              headers,
              data: { ...recipe, id: publicId, status },
            })
          ).ok(),
        ).toBe(true);
        expect(
          (
            await (
              await admin.request.get(`/api/recipes/resolve?id=${publicId}`)
            ).json()
          ).recipes,
        ).toHaveLength(0);
        expect(
          (await admin.request.get(`/recipes/${recipe.slug}`)).status(),
        ).toBe(404);
      }
    });
    await step("12 Unavailable / offline public fallback", async () => {
      await restored
        .getByRole("link", { name: "Избранное", exact: true })
        .click();
      await expect(
        restored.getByText("Публичный рецепт недоступен", { exact: true }),
      ).toBeVisible();
      expect((await snapshot(restored)).favorites.items).toHaveLength(2);
      await restored.route("**/api/recipes/resolve?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"Synthetic offline"}',
        }),
      );
      await restored.reload();
      await expect(
        restored.getByText("Временно не удалось загрузить рецепт", {
          exact: true,
        }),
      ).toBeVisible();
      await restored
        .getByRole("link", { name: "Список продуктов", exact: true })
        .click();
      expect((await snapshot(restored)).shopping.recipes).toHaveLength(2);
      expect(writes).toEqual([]);
    });
    failed = false;
  } finally {
    try {
      await step("13 Browser cleanup", async () => {
        await diagnostics.preserveBeforeClose();
        await step("13a Close visitor profile", async () => {
          await visitor?.close();
        });
        await step("13b Close restored profile", async () => {
          await restoredContext?.close();
        });
      });
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await diagnostics.finish(failed);
    }
  }
});

for (const denied of [false, true])
  test(`notification fallback refreshes on focus when BroadcastChannel ${denied ? "throws" : "is absent"}`, async ({
    context,
    page,
  }) => {
    await context.addInitScript((throws) => {
      Object.defineProperty(window, "BroadcastChannel", {
        configurable: true,
        value: throws
          ? class {
              constructor() {
                throw new DOMException(
                  "Synthetic restriction",
                  "SecurityError",
                );
              }
            }
          : undefined,
      });
    }, denied);
    await page.goto("/basket");
    const second = await context.newPage();
    await second.goto("/basket");
    await expect(
      second.getByRole("heading", { name: "Добавить вручную", exact: true }),
    ).toBeVisible();
    const form = page.getByRole("form", {
      name: "Добавить вручную",
      exact: true,
    });
    await form
      .getByLabel("Название продукта", { exact: true })
      .fill("Fallback shared product");
    await form
      .getByRole("button", { name: "Добавить продукт", exact: true })
      .click();
    await expect(
      form.getByLabel("Название продукта", { exact: true }),
    ).toHaveValue("");
    await second.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      second.getByRole("checkbox", {
        name: "Куплено: Fallback shared product",
        exact: true,
      }),
    ).toBeVisible();
    await second.close();
  });
