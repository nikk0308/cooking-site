import { z } from "zod";
import {
  localRecipeDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
import {
  recipeKey,
  recipeReference,
  uuid,
  type RecipeReference,
} from "@/modules/recipes/reference";
import { favoritesDocument } from "@/modules/favorites/document";
import {
  emptyShopping,
  shoppingDocument,
  type ShoppingDocument,
} from "@/modules/shopping/document";
import { basketKey, parseBasket } from "@/modules/basket/document";
import {
  BrowserStorageError,
  openBrowserDatabase,
  received,
  transaction,
  storageError,
} from "./database";

const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    raw: z.string().max(128 * 1024),
    expected: z.string().max(2 * 1024 * 1024),
    verified: z.boolean(),
  })
  .strict();
const wrapperSchema = z
  .object({ key: z.string(), schemaVersion: z.literal(1), value: z.unknown() })
  .strict();
const valueOf = (record: unknown) => decode(wrapperSchema, record).value;
function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    ![1, 2].includes(Number(value.schemaVersion))
  )
    throw new BrowserStorageError("UNSUPPORTED_VERSION");
  const result = schema.safeParse(value);
  if (!result.success) {
    const versionMismatch =
      value !== null &&
      typeof value === "object" &&
      "schemaVersion" in value &&
      typeof value.schemaVersion === "number" &&
      result.error.issues.some(
        (issue) => issue.path.length === 1 && issue.path[0] === "schemaVersion",
      );
    throw new BrowserStorageError(
      versionMismatch ? "UNSUPPORTED_VERSION" : "CORRUPTED",
    );
  }
  return result.data;
}
type Photo = { schemaVersion: 1; id: string; recipeId: string; blob: Blob };
export type PhotoInput = { id: string; blob: Blob };
function photo(raw: unknown, owner: string): Photo {
  const record = raw as Photo | undefined;
  if (
    !record ||
    record.schemaVersion !== 1 ||
    !uuid.safeParse(record.id).success ||
    record.recipeId !== owner ||
    !(record.blob instanceof Blob) ||
    !["image/jpeg", "image/png", "image/webp"].includes(record.blob.type) ||
    !record.blob.size ||
    record.blob.size > 10 * 1024 * 1024
  )
    throw new BrowserStorageError("CORRUPTED");
  return record;
}
export async function openBrowserRepository(name?: string) {
  const db = await openBrowserDatabase(name);
  const read = <T>(store: string, key: IDBValidKey) =>
    transaction<T | undefined>(db, [store], "readonly", (tx, done) =>
      received(tx, tx.objectStore(store).get(key), done),
    );
  const doc = <T>(key: string, schema: z.ZodType<T>, empty: () => T) =>
    read<{ key: string; schemaVersion: number; value: unknown }>(
      "documents",
      key,
    ).then((record) =>
      record === undefined ? empty() : decode(schema, valueOf(record)),
    );
  const update = <T>(
    key: string,
    schema: z.ZodType<T>,
    empty: () => T,
    change: (value: T) => T,
  ) =>
    transaction<T>(db, ["documents"], "readwrite", (tx, done) => {
      const store = tx.objectStore("documents");
      received(tx, store.get(key), (record) => {
        const value = schema.parse(
          change(
            record === undefined ? empty() : decode(schema, valueOf(record)),
          ),
        );
        store.put({ key, schemaVersion: 1, value });
        done(value);
      });
    });
  const listFavorites = () =>
    doc("favorites", favoritesDocument, () => ({
      schemaVersion: 1 as const,
      items: [],
    }));
  const favorites = {
    list: listFavorites,
    async has(ref: RecipeReference) {
      return (await listFavorites()).items.some(
        (r) => recipeKey(r) === recipeKey(ref),
      );
    },
    add: (raw: RecipeReference) => {
      const ref = recipeReference.parse(raw);
      return update(
        "favorites",
        favoritesDocument,
        () => ({ schemaVersion: 1 as const, items: [] }),
        (d) => ({
          ...d,
          items: d.items.some((r) => recipeKey(r) === recipeKey(ref))
            ? d.items
            : [...d.items, ref],
        }),
      );
    },
    remove: (ref: RecipeReference) =>
      update(
        "favorites",
        favoritesDocument,
        () => ({ schemaVersion: 1 as const, items: [] }),
        (d) => ({
          ...d,
          items: d.items.filter((r) => recipeKey(r) !== recipeKey(ref)),
        }),
      ),
  };
  const shopping = {
    get: () => doc("shopping", shoppingDocument, emptyShopping),
    update: (change: (value: ShoppingDocument) => ShoppingDocument) =>
      update("shopping", shoppingDocument, emptyShopping, change),
  };
  return {
    close: () => db.close(),
    favorites,
    shopping,
    requestPersistence: () =>
      navigator.storage?.persist?.() ?? Promise.resolve(false),
    async get(id: string) {
      const raw = await read("recipes", uuid.parse(id));
      return raw === undefined ? undefined : decode(localRecipeDocument, raw);
    },
    async list() {
      const rows = await transaction<unknown[]>(
        db,
        ["recipes"],
        "readonly",
        (tx, done) => received(tx, tx.objectStore("recipes").getAll(), done),
      );
      return rows.map((raw) => decode(localRecipeDocument, raw));
    },
    async getPhoto(recipeId: string, photoId: string): Promise<Blob | null> {
      const value = await read("photos", uuid.parse(photoId));
      return value === undefined
        ? null
        : photo(value, uuid.parse(recipeId)).blob;
    },
    async save(raw: RecipeDocument, assets: readonly PhotoInput[] = []) {
      const recipe = localRecipeDocument.parse(raw);
      const id = recipe.reference.id;
      if (
        new Set(assets.map((a) => a.id)).size !== assets.length ||
        recipe.photos.length !== assets.length ||
        recipe.photos.some((p) => !assets.some((a) => a.id === p.id))
      )
        throw new BrowserStorageError("CORRUPTED");
      const records = assets.map((a) =>
        photo({ ...a, schemaVersion: 1, recipeId: id }, id),
      );
      await transaction<void>(
        db,
        ["recipes", "photos"],
        "readwrite",
        (tx, done) => {
          const recipes = tx.objectStore("recipes"),
            photos = tx.objectStore("photos");
          received(tx, recipes.get(id), (old) => {
            const previous =
              old === undefined ? undefined : decode(localRecipeDocument, old);
            received(tx, recipes.count(), (count) => {
              if (!previous && count >= 500)
                throw new BrowserStorageError("CAPACITY");
              recipes.put(recipe);
              for (const p of previous?.photos ?? [])
                if (!recipe.photos.some((a) => a.id === p.id))
                  received(tx, photos.get(p.id), (value) => {
                    photo(value, id);
                    photos.delete(p.id);
                  });
              for (const record of records)
                received(tx, photos.get(record.id), (oldPhoto) => {
                  if (oldPhoto !== undefined) photo(oldPhoto, id);
                  photos.put(record);
                });
              done();
            });
          });
        },
      );
      return recipe;
    },
    async delete(rawId: string) {
      const id = uuid.parse(rawId);
      await transaction<void>(
        db,
        ["recipes", "photos"],
        "readwrite",
        (tx, done) => {
          const recipes = tx.objectStore("recipes"),
            photos = tx.objectStore("photos");
          received(tx, recipes.get(id), (raw) => {
            if (raw !== undefined) {
              const recipe = decode(localRecipeDocument, raw);
              for (const p of recipe.photos)
                received(tx, photos.get(p.id), (value) => {
                  photo(value, id);
                  photos.delete(p.id);
                });
              recipes.delete(id);
            }
            done();
          });
        },
      );
    },
    duplicate(rawId: string) {
      const id = uuid.parse(rawId),
        newId = crypto.randomUUID();
      return transaction<RecipeDocument>(
        db,
        ["recipes", "photos"],
        "readwrite",
        (tx, done) => {
          const recipes = tx.objectStore("recipes"),
            photos = tx.objectStore("photos");
          received(tx, recipes.get(id), (raw) => {
            const source = decode(localRecipeDocument, raw);
            received(tx, recipes.count(), (count) => {
              if (count >= 500) throw new BrowserStorageError("CAPACITY");
              const copy = localRecipeDocument.parse({
                ...source,
                reference: { kind: "LOCAL", id: newId },
                title: `${source.title.slice(0, 248)} (copy)`,
                photos: source.photos.map((p) => ({
                  ...p,
                  id: crypto.randomUUID(),
                })),
              });
              recipes.add(copy);
              source.photos.forEach((p, i) =>
                received(tx, photos.get(p.id), (value) => {
                  photos.add({
                    ...photo(value, id),
                    id: copy.photos[i].id,
                    recipeId: newId,
                  });
                }),
              );
              done(copy);
            });
          });
        },
      );
    },
    async migrateBasket(source: Pick<Storage, "getItem"> = localStorage) {
      let raw: string | null;
      try {
        raw = source.getItem(basketKey);
      } catch (error) {
        throw storageError(error);
      }
      if (raw === null) return "NO_SOURCE" as const;
      if (raw.length > 128 * 1024) throw new BrowserStorageError("CORRUPTED");
      let legacy;
      try {
        legacy = parseBasket(raw);
      } catch {
        throw new BrowserStorageError("CORRUPTED");
      }
      const result = await transaction<{
        status: "PENDING" | "ALREADY_MIGRATED" | "LEGACY_CHANGED";
        expected?: string;
      }>(db, ["documents"], "readwrite", (tx, done) => {
        const store = tx.objectStore("documents");
        received(tx, store.get("shopping"), (target) =>
          received(tx, store.get("migration:basket:v1"), (record) => {
            const current =
              target === undefined
                ? emptyShopping()
                : decode(shoppingDocument, valueOf(target));
            if (record !== undefined) {
              const receipt = decode(receiptSchema, valueOf(record));
              done(
                receipt.raw !== raw
                  ? { status: "LEGACY_CHANGED" }
                  : receipt.verified
                    ? { status: "ALREADY_MIGRATED" }
                    : { status: "PENDING", expected: receipt.expected },
              );
              return;
            }
            const next = shoppingDocument.parse({
              ...current,
              recipes: [...current.recipes],
            });
            for (const item of legacy.items) {
              const ref = { kind: "PUBLIC" as const, id: item.recipeId };
              if (
                !next.recipes.some(
                  (i) => recipeKey(i.reference) === recipeKey(ref),
                )
              ) {
                let id = item.recipeId;
                while (next.recipes.some((i) => i.id === id))
                  id = crypto.randomUUID();
                next.recipes.push({
                  id,
                  reference: ref,
                  selectedServings: item.selectedServings,
                  addedAt: item.addedAt,
                });
              }
            }
            const value = shoppingDocument.parse(next),
              expected = JSON.stringify(value);
            store.put({ key: "shopping", schemaVersion: 1, value });
            store.put({
              key: "migration:basket:v1",
              schemaVersion: 1,
              value: { schemaVersion: 1, raw, expected, verified: false },
            });
            done({ status: "PENDING", expected });
          }),
        );
      });
      if (result.status !== "PENDING") return result.status;
      await transaction<void>(db, ["documents"], "readwrite", (tx, done) => {
        const store = tx.objectStore("documents");
        received(tx, store.get("shopping"), (target) =>
          received(tx, store.get("migration:basket:v1"), (record) => {
            const current = decode(shoppingDocument, valueOf(target)),
              receipt = decode(receiptSchema, valueOf(record));
            if (
              JSON.stringify(current) !== result.expected ||
              receipt.raw !== raw ||
              receipt.expected !== result.expected
            )
              throw new BrowserStorageError("VERIFY_FAILED");
            store.put({
              key: "migration:basket:v1",
              schemaVersion: 1,
              value: { ...receipt, verified: true },
            });
            done();
          }),
        );
      });
      return source.getItem(basketKey) === raw
        ? ("MIGRATED" as const)
        : ("LEGACY_CHANGED" as const);
    },
  };
}
