import {
  test,
  expect,
  chromium,
  firefox,
  webkit,
  type Browser,
} from "@playwright/test";
import sharp from "sharp";
import { browserProfile } from "../helpers/playwright";
import {
  bundle,
  snapshot,
  exportFile,
  importFile,
} from "../helpers/browser-release";
import { localRecipe } from "../helpers/v02";
const engines = { chromium, firefox, webkit },
  running = new Map<string, Browser>();
async function engine(name: keyof typeof engines) {
  let browser = running.get(name);
  if (!browser) {
    browser = await engines[name].launch();
    running.set(name, browser);
  }
  return browser;
}
test.afterAll(async () => {
  for (const browser of running.values()) await browser.close();
});
for (const from of Object.keys(engines) as (keyof typeof engines)[])
  for (const to of Object.keys(engines) as (keyof typeof engines)[])
    test(`portable v1 backup ${from} -> ${to}: complete photo/data, repeat and future rejection`, async () => {
      const source = await browserProfile(await engine(from)),
        target = await browserProfile(await engine(to));
      try {
        const page = await source.newPage();
        await page.goto("http://127.0.0.1:3100/my-recipes");
        await page.addScriptTag({ content: bundle });
        const recipe = localRecipe();
        recipe.title = "Portable synthetic recipe";
        recipe.photos = [
          {
            kind: "LOCAL",
            id: "70000000-0000-4000-8000-000000000001",
            alt: "Portable synthetic photograph",
          },
        ];
        const bytes = await sharp({
          create: { width: 16, height: 12, channels: 3, background: "#558855" },
        })
          .png()
          .toBuffer();
        await page.evaluate(
          async ({ recipe, bytes }) => {
            const repo =
              await window.CulinoteFoundation.openBrowserRepository();
            try {
              await repo.save(recipe, [
                {
                  id: recipe.photos[0].id,
                  blob: new Blob([new Uint8Array(bytes)], {
                    type: "image/png",
                  }),
                },
              ]);
              await repo.favorites.add(recipe.reference);
              await repo.favorites.add({
                kind: "PUBLIC",
                id: recipe.reference.id,
              });
              await repo.shopping.update((d) => {
                const next = {
                  ...d,
                  recipes: [
                    {
                      id: crypto.randomUUID(),
                      reference: recipe.reference,
                      selectedServings: 6,
                      addedAt: "2026-10-27T00:00:00Z",
                    },
                  ],
                  manual: [
                    {
                      id: crypto.randomUUID(),
                      product: {
                        kind: "LOCAL" as const,
                        id: crypto.randomUUID(),
                      },
                      name: "Portable manual",
                      quantity: "0.000001",
                      unit: recipe.ingredients[0].unit,
                    },
                  ],
                };
                const resolved = window.CulinoteFoundation.resolveShopping(
                  next,
                  [recipe],
                );
                return {
                  ...next,
                  overrides: [
                    {
                      id: resolved.items[0].id,
                      purchased: true,
                      quantity: "800",
                    },
                  ],
                };
              });
              localStorage.setItem(
                "recipes:basket:v1",
                '{"schemaVersion":1,"items":[]}',
              );
              localStorage.setItem(
                "unrelated-token",
                "NEVER_EXPORT_PRIVATE_TOKEN",
              );
            } finally {
              repo.close();
            }
          },
          { recipe, bytes: Array.from(bytes) },
        );
        const before = await snapshot(page),
          download = await exportFile(page);
        expect(download.toString()).not.toContain("NEVER_EXPORT_PRIVATE_TOKEN");
        expect(download.toString()).not.toContain("recipes:basket:v1");
        expect(
          await page.evaluate(() => localStorage.getItem("recipes:basket:v1")),
        ).toBe('{"schemaVersion":1,"items":[]}');
        const older = JSON.parse(download.toString());
        older.createdAt = "2026-10-27T00:00:00Z";
        const file = Buffer.from(JSON.stringify(older));
        const restored = await target.newPage(),
          writes: string[] = [];
        restored.on("request", (r) => {
          if (!["GET", "HEAD"].includes(r.method())) writes.push(r.url());
        });
        await restored.goto("http://127.0.0.1:3100/my-recipes");
        await importFile(restored, file);
        expect(await snapshot(restored)).toEqual(before);
        await importFile(restored, file);
        expect(await snapshot(restored)).toEqual(before);
        older.schemaVersion = 99;
        await restored
          .getByLabel("Восстановить из backup JSON", { exact: true })
          .setInputFiles({
            name: "future.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(older)),
          });
        await expect(restored.locator("main").getByRole("alert")).toBeVisible();
        expect(await snapshot(restored)).toEqual(before);
        expect(writes).toEqual([]);
      } finally {
        await source.close();
        await target.close();
      }
    });
