import { test, expect } from "../helpers/playwright";
import { bundle } from "../helpers/browser-release";
import { localRecipe } from "../helpers/v02";

test("private-context Blob restriction fails explicitly and atomically; regular profiles remain covered", async ({
  browser,
  browserName,
}) => {
  // Deliberately use a private context here, unlike the regular-profile fixture.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route("http://127.0.0.1:3100/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Synthetic private storage</title>",
      }),
    );
    await page.goto("http://127.0.0.1:3100/");
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async (recipe) => {
      const repo = await window.CulinoteFoundation.openBrowserRepository();
      try {
        await repo.save(recipe);
        const photoId = crypto.randomUUID();
        const updated = {
          ...recipe,
          title: "Synthetic changed",
          photos: [{ kind: "LOCAL" as const, id: photoId, alt: "Synthetic" }],
        };
        let error: { code?: string; cause?: string } | null = null;
        try {
          await repo.save(updated, [
            {
              id: photoId,
              blob: new Blob(["synthetic"], { type: "image/png" }),
            },
          ]);
        } catch (e) {
          const err = e as Error & { code: string };
          error = { code: err.code, cause: (err.cause as Error)?.name };
        }
        return {
          error,
          recipe: await repo.get(recipe.reference.id),
          photo: !!(await repo.getPhoto(recipe.reference.id, photoId)),
        };
      } finally {
        repo.close();
      }
    }, localRecipe());
    if (browserName === "webkit") {
      expect(result.error?.code).toBe("UNAVAILABLE");
      expect(result.error?.cause).toBe("UnknownError");
      expect(result.recipe).toEqual(localRecipe());
      expect(result.photo).toBe(false);
    } else {
      expect(result.error).toBeNull();
      expect(result.recipe?.title).toBe("Synthetic changed");
      expect(result.photo).toBe(true);
    }
  } finally {
    await context.close();
  }
});
