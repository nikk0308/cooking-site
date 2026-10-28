import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { localRecipe } from "../helpers/v02";
import type * as Foundation from "../../src/platform/browser/foundation";

declare global {
  interface Window {
    CulinoteFoundation: typeof Foundation;
  }
}
// Test-only bundle: exercises actual production modules in Chromium's IndexedDB
// without exposing a test route, UI or additional API in the application.
const bundle = buildSync({
  entryPoints: ["src/platform/browser/foundation.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CulinoteFoundation",
  platform: "browser",
  target: "es2022",
}).outputFiles[0].text;
async function browser(page: Page) {
  await page.route("http://127.0.0.1:3100/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Browser persistence tests</title>",
    }),
  );
  await page.goto("/");
  await page.addScriptTag({ content: bundle });
}
test.beforeEach(async ({ page }) => browser(page));

test("local CRUD, Blob persistence, duplication, favorites and deletion stay in browser", async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" ||
      request.url() !== "http://127.0.0.1:3100/"
    )
      outbound.push(request.url());
  });
  const fixture = localRecipe();
  const result = await page.evaluate(async (r) => {
    const api = window.CulinoteFoundation,
      repo = await api.openBrowserRepository("crud");
    const id = crypto.randomUUID();
    r.photos = [{ kind: "LOCAL", id, alt: "Private photograph" }];
    await repo.save(r, [
      {
        id,
        blob: new Blob(["persistent-image-bytes"], { type: "image/webp" }),
      },
    ]);
    await Promise.all([
      repo.favorites.add(r.reference),
      repo.favorites.add(r.reference),
      repo.favorites.add({ kind: "PUBLIC", id: r.reference.id }),
    ]);
    const copy = await repo.duplicate(r.reference.id);
    await repo.shopping.update((d) => ({
      ...d,
      overrides: [{ id: "stable-row", quantity: "999", purchased: true }],
    }));
    const { has } = repo.favorites;
    const data = {
      count: (await repo.list()).length,
      favorites: (await repo.favorites.list()).items.length,
      has: await has(r.reference),
      copyId: copy.reference.id,
      copyPhoto: copy.photos[0].id,
      sourcePhoto: id,
      bytes: await (await repo.getPhoto(
        copy.reference.id,
        copy.photos[0].id,
      ))!.text(),
    };
    repo.close();
    return data;
  }, fixture);
  expect(result).toMatchObject({
    count: 2,
    favorites: 2,
    has: true,
    bytes: "persistent-image-bytes",
  });
  expect(result.copyId).not.toBe(fixture.reference.id);
  expect(result.copyPhoto).not.toBe(result.sourcePhoto);
  await page.reload();
  await page.addScriptTag({ content: bundle });
  const reloaded = await page.evaluate(
    async ({ id, copyId, photoId }) => {
      const repo =
        await window.CulinoteFoundation.openBrowserRepository("crud");
      const r = (await repo.get(id))!;
      r.title = "Edited locally";
      await repo.save(r, [
        { id: photoId, blob: (await repo.getPhoto(id, photoId))! },
      ]);
      await repo.delete(id);
      const favorites = await window.CulinoteFoundation.resolveFavorites(
        (await repo.favorites.list()).items,
        async (ref) => (ref.kind === "LOCAL" ? await repo.get(ref.id) : null),
      );
      const result = {
        count: (await repo.list()).length,
        original: await repo.get(id),
        missingBlob: await repo.getPhoto(id, photoId),
        copy: (await repo.get(copyId))?.title,
        unavailable: favorites.every((f) => f.availability === "UNAVAILABLE"),
        overrides: (await repo.shopping.get()).overrides,
      };
      await repo.favorites.remove({ kind: "LOCAL", id });
      repo.close();
      return result;
    },
    {
      id: fixture.reference.id,
      copyId: result.copyId,
      photoId: result.sourcePhoto,
    },
  );
  expect(reloaded).toMatchObject({
    count: 1,
    original: undefined,
    missingBlob: null,
    unavailable: true,
    copy: "Personal recipe (copy)",
    overrides: [{ id: "stable-row", quantity: "999", purchased: true }],
  });
  expect(outbound).toEqual([]);
});

test("quota abort rolls back recipe and photo updates together", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    const repo = await window.CulinoteFoundation.openBrowserRepository("quota");
    const id = crypto.randomUUID();
    r.photos = [{ kind: "LOCAL", id, alt: "" }];
    await repo.save(r, [
      { id, blob: new Blob(["original"], { type: "image/png" }) },
    ]);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "photos")
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      return originalPut.apply(this, args);
    };
    let code;
    try {
      await repo.save({ ...r, title: "Must roll back" }, [
        { id, blob: new Blob(["replacement"], { type: "image/png" }) },
      ]);
    } catch (error) {
      code = (error as { code: string }).code;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const data = {
      code,
      title: (await repo.get(r.reference.id))!.title,
      bytes: await (await repo.getPhoto(r.reference.id, id))!.text(),
    };
    repo.close();
    return data;
  }, localRecipe());
  expect(result).toEqual({
    code: "QUOTA",
    title: "Personal recipe",
    bytes: "original",
  });
});

test("basket v1 migration is atomic, read-back verified, retryable and never deletes source", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    const repo =
      await window.CulinoteFoundation.openBrowserRepository("migration");
    await repo.shopping.update((d) => ({
      ...d,
      recipes: [
        {
          id: r.reference.id,
          reference: r.reference,
          selectedServings: 2,
          addedAt: "2026-10-28T00:00:00Z",
        },
      ],
      manual: [
        {
          id: crypto.randomUUID(),
          product: { kind: "LOCAL", id: crypto.randomUUID() },
          name: "Keep manual",
          quantity: "2",
          unit: r.ingredients[0].unit,
        },
      ],
    }));
    const raw = JSON.stringify({
      schemaVersion: 1,
      items: [
        {
          recipeId: r.reference.id,
          selectedServings: 6,
          addedAt: "2026-10-28T00:00:00Z",
          schemaVersion: 1,
        },
      ],
    });
    localStorage.setItem("recipes:basket:v1", raw);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      if (this.name === "documents" && value.key === "migration:basket:v1")
        throw new DOMException("Receipt write failed", "QuotaExceededError");
      return originalPut.call(this, value, ...rest);
    };
    let code;
    try {
      await repo.migrateBasket();
    } catch (error) {
      code = (error as { code: string }).code;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    const afterAbort = (await repo.shopping.get()).recipes.length;
    const first = await repo.migrateBasket(),
      second = await repo.migrateBasket();
    const sourcePreserved = localStorage.getItem("recipes:basket:v1") === raw;
    const shopping = await repo.shopping.get();
    localStorage.setItem(
      "recipes:basket:v1",
      raw.replace('"selectedServings":6', '"selectedServings":8'),
    );
    const changed = await repo.migrateBasket();
    repo.close();
    return {
      code,
      afterAbort,
      first,
      second,
      sourcePreserved,
      shopping,
      changed,
    };
  }, localRecipe());
  expect(result).toMatchObject({
    code: "QUOTA",
    afterAbort: 1,
    first: "MIGRATED",
    second: "ALREADY_MIGRATED",
    sourcePreserved: true,
    changed: "LEGACY_CHANGED",
  });
  expect(result.shopping.recipes).toHaveLength(2);
  expect(result.shopping.recipes[1]).toMatchObject({
    reference: { kind: "PUBLIC" },
    selectedServings: 6,
  });
  expect(result.shopping.recipes[0].id).not.toBe(result.shopping.recipes[1].id);
  expect(result.shopping.manual[0].name).toBe("Keep manual");
});

test("IndexedDB additive upgrade preserves v1 records; failed upgrade rolls back", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    async function legacy(name: string, keyPath: string) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("recipes", { keyPath });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("recipes", "readwrite");
          tx.objectStore("recipes").put(
            keyPath === "id" ? { id: "preserve", payload: "legacy" } : r,
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
    }
    await legacy("upgrade", "reference.id");
    const repo =
      await window.CulinoteFoundation.openBrowserRepository("upgrade");
    const recipe = await repo.get(r.reference.id);
    repo.close();
    await legacy("failed-upgrade", "id");
    let code;
    try {
      await window.CulinoteFoundation.openBrowserRepository("failed-upgrade");
    } catch (error) {
      code = (error as { code: string }).code;
    }
    const original = await new Promise<unknown>((resolve) => {
      const request = indexedDB.open("failed-upgrade", 1);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("recipes");
        const get = tx.objectStore("recipes").get("preserve");
        get.onsuccess = () =>
          resolve({ version: db.version, value: get.result });
        tx.oncomplete = () => db.close();
      };
    });
    return { title: recipe?.title, code, original };
  }, localRecipe());
  expect(result).toEqual({
    title: "Personal recipe",
    code: "UPGRADE_FAILED",
    original: { version: 1, value: { id: "preserve", payload: "legacy" } },
  });
});

test("corrupted and future-version records are reported and never silently overwritten", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    const repo =
      await window.CulinoteFoundation.openBrowserRepository("corrupted");
    await repo.save(r);
    repo.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("corrupted");
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(["recipes", "documents"], "readwrite");
        tx.objectStore("recipes").put({ ...r, schemaVersion: 999 });
        tx.objectStore("documents").put({
          key: "favorites",
          schemaVersion: 1,
          value: { schemaVersion: 1, items: "bad" },
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    const second =
        await window.CulinoteFoundation.openBrowserRepository("corrupted"),
      codes: string[] = [];
    for (const op of [
      () => second.get(r.reference.id),
      () => second.save(r),
      () => second.favorites.add(r.reference),
    ]) {
      try {
        await op();
      } catch (error) {
        codes.push((error as { code: string }).code);
      }
    }
    localStorage.setItem("recipes:basket:v1", "not-json");
    try {
      await second.migrateBasket();
    } catch (error) {
      codes.push((error as { code: string }).code);
    }
    second.close();
    return { codes, raw: localStorage.getItem("recipes:basket:v1") };
  }, localRecipe());
  expect(result).toEqual({
    codes: [
      "UNSUPPORTED_VERSION",
      "UNSUPPORTED_VERSION",
      "CORRUPTED",
      "CORRUPTED",
    ],
    raw: "not-json",
  });
});

test("unauthenticated catalog mutation remains protected", async ({
  request,
}) => {
  const response = await request.post("/api/admin/ingredients", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { name: "Forbidden", slug: "forbidden", nutrition: null },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/admin/login");
});

test("blocked and future database versions are explicit and leave existing data intact", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    const held = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("held", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("recipes", {
          keyPath: "reference.id",
        });
      request.onsuccess = () => {
        const tx = request.result.transaction("recipes", "readwrite");
        tx.objectStore("recipes").put(r);
        tx.oncomplete = () => resolve(request.result);
      };
    });
    let blocked;
    try {
      await window.CulinoteFoundation.openBrowserRepository("held");
    } catch (error) {
      blocked = (error as { code: string }).code;
    }
    held.close();
    const retry = await window.CulinoteFoundation.openBrowserRepository("held");
    const title = (await retry.get(r.reference.id))?.title;
    retry.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("future", 9);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("sentinel");
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    let future;
    try {
      await window.CulinoteFoundation.openBrowserRepository("future");
    } catch (error) {
      future = (error as { code: string }).code;
    }
    return { blocked, title, future };
  }, localRecipe());
  expect(result).toEqual({
    blocked: "BLOCKED",
    title: "Personal recipe",
    future: "UNSUPPORTED_VERSION",
  });
});

test("migration resumes after the write committed but verification receipt failed", async ({
  page,
}) => {
  const result = await page.evaluate(async (r) => {
    const repo =
      await window.CulinoteFoundation.openBrowserRepository("verify-retry");
    const raw = JSON.stringify({
      schemaVersion: 1,
      items: [
        {
          schemaVersion: 1,
          recipeId: r.reference.id,
          selectedServings: 6,
          addedAt: "2026-10-28T00:00:00Z",
        },
      ],
    });
    localStorage.setItem("recipes:basket:v1", raw);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (
        this.name === "documents" &&
        value.key === "migration:basket:v1" &&
        value.value.verified
      )
        throw new DOMException(
          "Synthetic receipt failure",
          "QuotaExceededError",
        );
      return put.call(this, value, ...args);
    };
    let code;
    try {
      await repo.migrateBasket();
    } catch (error) {
      code = (error as { code: string }).code;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const before = (await repo.shopping.get()).recipes.length;
    const retry = await repo.migrateBasket(),
      after = (await repo.shopping.get()).recipes.length;
    repo.close();
    return {
      code,
      before,
      retry,
      after,
      preserved: localStorage.getItem("recipes:basket:v1") === raw,
    };
  }, localRecipe());
  expect(result).toEqual({
    code: "QUOTA",
    before: 1,
    retry: "MIGRATED",
    after: 1,
    preserved: true,
  });
});
