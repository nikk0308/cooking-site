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
import {
  favoritesDocument,
  type FavoritesDocument,
} from "@/modules/favorites/document";
import {
  emptyShopping,
  shoppingDocument,
  type ShoppingDocument,
} from "@/modules/shopping/document";
import { basketKey, parseBasket } from "@/modules/basket/document";
import {
  legacyReceipt,
  legacyPlan,
  type LegacyPreview,
} from "@/modules/shopping/legacy";
import {
  BrowserStorageError,
  openBrowserDatabase,
  received,
  transaction,
  storageError,
  readRevision,
} from "./database";

const receiptSchema = legacyReceipt;
const checkpointSchema = z
  .object({ before: shoppingDocument, after: shoppingDocument })
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
export type StoredPhoto = {
  schemaVersion: 1;
  id: string;
  recipeId: string;
  blob: Blob;
};
type Photo = StoredPhoto;
export type BrowserSnapshot = {
  revision: number;
  recipes: RecipeDocument[];
  photos: StoredPhoto[];
  favorites: FavoritesDocument;
  shopping: ShoppingDocument;
};
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
  const db = await Promise.resolve()
    .then(() => openBrowserDatabase(name))
    .catch((error) => {
      throw storageError(error);
    });
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
    revision?: number,
  ) =>
    transaction<T>(
      db,
      ["documents"],
      "readwrite",
      (tx, done) => {
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
      },
      revision,
    );
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
    view() {
      return transaction<{
        document: ShoppingDocument;
        revision: number;
        checkpoint: z.infer<typeof checkpointSchema> | null;
      }>(db, ["documents"], "readonly", (tx, done) => {
        const store = tx.objectStore("documents");
        received(tx, store.get("shopping"), (record) =>
          received(tx, store.get("revision"), (revision) =>
            received(tx, store.get("shopping:undo"), (checkpoint) => {
              done({
                document:
                  record === undefined
                    ? shoppingDocument.parse(emptyShopping())
                    : decode(shoppingDocument, valueOf(record)),
                revision: readRevision(revision),
                checkpoint:
                  checkpoint === undefined
                    ? null
                    : decode(checkpointSchema, valueOf(checkpoint)),
              });
            }),
          ),
        );
      });
    },
    update: (
      change: (value: ShoppingDocument) => ShoppingDocument,
      revision?: number,
    ) => update("shopping", shoppingDocument, emptyShopping, change, revision),
    checkpoint: () =>
      doc("shopping:undo", checkpointSchema.nullable(), () => null),
    checkpointUpdate(
      change: (value: ShoppingDocument) => ShoppingDocument,
      revision: number,
    ) {
      return transaction<ShoppingDocument>(
        db,
        ["documents"],
        "readwrite",
        (tx, done) => {
          const store = tx.objectStore("documents");
          received(tx, store.get("shopping"), (record) => {
            const before =
              record === undefined
                ? shoppingDocument.parse(emptyShopping())
                : decode(shoppingDocument, valueOf(record));
            const after = shoppingDocument.parse(change(before));
            store.put({
              key: "shopping:undo",
              schemaVersion: 1,
              value: { before, after },
            });
            store.put({ key: "shopping", schemaVersion: 1, value: after });
            done(after);
          });
        },
        revision,
      );
    },
    undo() {
      return transaction<void>(db, ["documents"], "readwrite", (tx, done) => {
        const store = tx.objectStore("documents");
        received(tx, store.get("shopping:undo"), (record) => {
          if (!record) throw new BrowserStorageError("VERIFY_FAILED");
          const checkpoint = decode(checkpointSchema, valueOf(record));
          received(tx, store.get("shopping"), (current) => {
            if (
              JSON.stringify(decode(shoppingDocument, valueOf(current))) !==
              JSON.stringify(checkpoint.after)
            )
              throw new BrowserStorageError("VERIFY_FAILED");
            store.put({
              key: "shopping",
              schemaVersion: 1,
              value: checkpoint.before,
            });
            store.delete("shopping:undo");
            done();
          });
        });
      });
    },
  };
  return {
    close: () => db.close(),
    favorites,
    shopping,
    async legacyPreview(
      source: Pick<Storage, "getItem"> = localStorage,
    ): Promise<LegacyPreview> {
      let raw: string | null;
      try {
        raw = source.getItem(basketKey);
      } catch (error) {
        throw storageError(error);
      }
      return transaction<LegacyPreview>(
        db,
        ["documents"],
        "readonly",
        (tx, done) => {
          const store = tx.objectStore("documents");
          received(tx, store.get("shopping"), (target) =>
            received(tx, store.get("migration:basket:v1"), (receipt) =>
              received(tx, store.get("revision"), (revision) => {
                done({
                  raw,
                  shopping:
                    target === undefined
                      ? shoppingDocument.parse(emptyShopping())
                      : decode(shoppingDocument, valueOf(target)),
                  receipt:
                    receipt === undefined
                      ? null
                      : decode(receiptSchema, valueOf(receipt)),
                  revision: readRevision(revision),
                });
              }),
            ),
          );
        },
      );
    },
    async reconcileLegacy(
      preview: LegacyPreview,
      choices: Record<string, "V1" | "V2">,
      source: Pick<Storage, "getItem"> = localStorage,
    ) {
      if (preview.raw === null || !preview.receipt)
        throw new BrowserStorageError("VERIFY_FAILED");
      const plan = legacyPlan(preview, choices);
      if (plan.conflicts.length) throw new BrowserStorageError("VERIFY_FAILED");
      await transaction<void>(
        db,
        ["documents"],
        "readwrite",
        (tx, done) => {
          const store = tx.objectStore("documents");
          received(tx, store.get("migration:basket:v1"), (record) => {
            if (
              source.getItem(basketKey) !== preview.raw ||
              JSON.stringify(decode(receiptSchema, valueOf(record))) !==
                JSON.stringify(preview.receipt)
            )
              throw new BrowserStorageError("VERIFY_FAILED");
            store.put({ key: "shopping", schemaVersion: 1, value: plan.next });
            store.put({
              key: "migration:basket:v1",
              schemaVersion: 1,
              value: {
                schemaVersion: 1,
                raw: preview.raw,
                originalRaw:
                  preview.receipt!.originalRaw ?? preview.receipt!.raw,
                expected: JSON.stringify(plan.next),
                verified: false,
              },
            });
            done();
          });
        },
        preview.revision,
      );
    },
    requestPersistence: () =>
      navigator.storage?.persist?.() ?? Promise.resolve(false),
    snapshot() {
      return transaction<BrowserSnapshot>(
        db,
        ["recipes", "photos", "documents"],
        "readonly",
        (tx, done) => {
          received(tx, tx.objectStore("recipes").getAll(), (rawRecipes) =>
            received(tx, tx.objectStore("photos").getAll(), (rawPhotos) =>
              received(
                tx,
                tx.objectStore("documents").getAll(),
                (rawDocs: { key: string; value: unknown }[]) => {
                  const recipes = rawRecipes.map((r) =>
                    decode(localRecipeDocument, r),
                  );
                  const photos = rawPhotos.map((p) => photo(p, p.recipeId));
                  if (
                    recipes.some((r) =>
                      r.photos.some(
                        (p) =>
                          !photos.some(
                            (a) =>
                              a.id === p.id && a.recipeId === r.reference.id,
                          ),
                      ),
                    ) ||
                    photos.some(
                      (p) =>
                        !recipes.some(
                          (r) =>
                            r.reference.id === p.recipeId &&
                            r.photos.some((a) => a.id === p.id),
                        ),
                    )
                  )
                    throw new BrowserStorageError("CORRUPTED");
                  const find = (key: string) =>
                    rawDocs.find((d) => d.key === key);
                  const fav = find("favorites"),
                    shop = find("shopping");
                  done({
                    revision: readRevision(find("revision")),
                    recipes,
                    photos,
                    favorites: fav
                      ? decode(favoritesDocument, valueOf(fav))
                      : { schemaVersion: 1, items: [] },
                    shopping: shop
                      ? decode(shoppingDocument, valueOf(shop))
                      : emptyShopping(),
                  });
                },
              ),
            ),
          );
        },
      );
    },
    restore(
      data: {
        recipes: RecipeDocument[];
        photos: StoredPhoto[];
        favorites: FavoritesDocument;
        shopping: ShoppingDocument;
      },
      revision: number,
    ) {
      const recipes = data.recipes.map((r) => localRecipeDocument.parse(r));
      const photos = data.photos.map((p) => photo(p, p.recipeId));
      const favorites = favoritesDocument.parse(data.favorites),
        shopping = shoppingDocument.parse(data.shopping);
      if (
        photos.some(
          (p) =>
            !recipes.some(
              (r) =>
                r.reference.id === p.recipeId &&
                r.photos.some((a) => a.id === p.id),
            ),
        ) ||
        recipes.some((r) =>
          r.photos.some(
            (p) =>
              !photos.some(
                (a) => a.id === p.id && a.recipeId === r.reference.id,
              ),
          ),
        )
      )
        throw new BrowserStorageError("CORRUPTED");
      return transaction<void>(
        db,
        ["recipes", "photos", "documents"],
        "readwrite",
        (tx, done) => {
          const store = tx.objectStore("recipes");
          received(tx, store.count(), (count) => {
            if (count + recipes.length > 500)
              throw new BrowserStorageError("CAPACITY");
            for (const r of recipes) store.add(r);
            for (const p of photos) tx.objectStore("photos").add(p);
            tx.objectStore("documents").put({
              key: "favorites",
              schemaVersion: 1,
              value: favorites,
            });
            tx.objectStore("documents").put({
              key: "shopping",
              schemaVersion: 1,
              value: shopping,
            });
            done();
          });
        },
        revision,
      );
    },
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
    async save(
      raw: RecipeDocument,
      assets: readonly PhotoInput[] = [],
      expected?: RecipeDocument,
    ) {
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
            if (
              expected &&
              JSON.stringify(previous) !==
                JSON.stringify(localRecipeDocument.parse(expected))
            )
              throw new BrowserStorageError("VERIFY_FAILED");
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
                title: `${source.title.slice(0, 248)} (копия)`,
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
    async migrateBasket(
      source: Pick<Storage, "getItem"> = localStorage,
      expected?: { raw: string; revision: number },
    ) {
      let raw: string | null;
      try {
        raw = source.getItem(basketKey);
      } catch (error) {
        throw storageError(error);
      }
      if (expected && raw !== expected.raw)
        throw new BrowserStorageError("VERIFY_FAILED");
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
      }>(
        db,
        ["documents"],
        "readwrite",
        (tx, done) => {
          const store = tx.objectStore("documents");
          received(tx, store.get("shopping"), (target) =>
            received(tx, store.get("migration:basket:v1"), (record) => {
              if (source.getItem(basketKey) !== raw)
                throw new BrowserStorageError("VERIFY_FAILED");
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
        },
        expected?.revision,
      );
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
