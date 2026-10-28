import { beforeAll, afterAll, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import { catalogRepository } from "@/modules/catalog/repository";
import { normalizeIngredientName } from "@/modules/catalog/normalization";
import { recipeRepository } from "@/modules/recipes/repository";
import { resolvePublicDocuments } from "@/modules/recipes/public-documents";
import { publicRecipeDocument } from "@/modules/recipes/document";
import {
  ingredients,
  ingredientAliases,
  ingredientCategories,
  ingredientNutrition,
  standardUnitIds,
} from "../../db/schema";

let fixture: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  fixture = await isolatedDatabase();
}, 30000);
afterAll(async () => {
  await fixture?.cleanup();
});

it("upgrades v0.1 with real data without changing IDs, values, publications or admin records; rerun is a no-op", async () => {
  const folder = await mkdtemp(
    path.join(os.tmpdir(), "culinote-v01-migrations-"),
  );
  let legacy: Awaited<ReturnType<typeof isolatedDatabase>> | undefined;
  try {
    await mkdir(path.join(folder, "meta"));
    const journal = JSON.parse(
      await readFile("db/migrations/meta/_journal.json", "utf8"),
    );
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 2);
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        `db/migrations/${entry.tag}.sql`,
        path.join(folder, `${entry.tag}.sql`),
      );
    legacy = await isolatedDatabase(folder);
    const ingredient = (
      await legacy.pool.query(
        "INSERT INTO ingredients (name,slug) VALUES ('Творог','legacy-tvorog') RETURNING id",
      )
    ).rows[0];
    await legacy.pool.query(
      "INSERT INTO ingredient_nutrition (ingredient_id,basis_quantity,basis_unit_id,calories_kcal,protein_g,fat_g,carbohydrates_g,source_note) VALUES ($1,100,$2,121,17,5,2,'legacy source')",
      [ingredient.id, standardUnitIds.g],
    );
    const recipe = (
      await legacy.pool.query(
        "INSERT INTO recipes (title,slug,base_servings,status,published_at) VALUES ('Legacy','legacy',4,'PUBLISHED',now()) RETURNING id",
      )
    ).rows[0];
    await legacy.pool.query(
      "INSERT INTO recipe_ingredients (recipe_id,ingredient_id,quantity,unit_id,position) VALUES ($1,$2,'500.123456',$3,1)",
      [recipe.id, ingredient.id, standardUnitIds.g],
    );
    await legacy.pool.query(
      "INSERT INTO recipe_steps (recipe_id,position,instruction) VALUES ($1,1,'Mix')",
      [recipe.id],
    );
    await legacy.pool.query(
      "INSERT INTO admin_users (email,password_hash) VALUES ('legacy@example.invalid','fixture-hash')",
    );
    const media = (
      await legacy.pool.query(
        "INSERT INTO media (storage_key,mime_type,width,height,size_bytes,sha256) VALUES ('70000000-0000-4000-8000-000000000001.webp','image/webp',8,8,32,$1) RETURNING id",
        ["a".repeat(64)],
      )
    ).rows[0];
    await legacy.pool.query(
      "UPDATE recipes SET cover_media_id=$1 WHERE id=$2",
      [media.id, recipe.id],
    );
    const oldValues = async () => ({
      ingredients: (
        await legacy!.pool.query(
          "SELECT id,name,slug,created_at,updated_at FROM ingredients ORDER BY id",
        )
      ).rows,
      nutrition: (
        await legacy!.pool.query(
          "SELECT ingredient_id,basis_quantity,basis_unit_id,calories_kcal,protein_g,fat_g,carbohydrates_g,source_note,created_at,updated_at FROM ingredient_nutrition ORDER BY ingredient_id",
        )
      ).rows,
    });
    const originalValues = await oldValues();
    const snapshots = async () =>
      Promise.all(
        [
          "recipes",
          "recipe_ingredients",
          "recipe_steps",
          "units",
          "admin_users",
          "media",
        ].map(
          async (table) =>
            (
              await legacy!.pool.query(
                `SELECT row_to_json(t) AS row FROM ${table} t ORDER BY id`,
              )
            ).rows,
        ),
      );
    const before = await snapshots();
    await migrate(legacy.db, { migrationsFolder: "db/migrations" });
    await migrate(legacy.db, { migrationsFolder: "db/migrations" });
    expect(await snapshots()).toEqual(before);
    expect(await oldValues()).toEqual(originalValues);
    const repo = recipeRepository(legacy.db);
    expect(
      (await repo.resolvePublishedRecipes([recipe.id]))[0].ingredients[0].line
        .quantity,
    ).toBe("500.123456");
    expect(
      (await catalogRepository(legacy.db).findByIds([ingredient.id]))[0],
    ).toMatchObject({
      ingredient: {
        id: ingredient.id,
        normalizedName: "творог",
        categoryId: null,
      },
      nutrition: {
        sourceKind: "UNKNOWN",
        sourceNote: "legacy source",
        sourceUrl: null,
      },
    });
    expect(
      (
        await legacy.pool.query(
          "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0].n,
    ).toBe(3);
  } finally {
    await legacy?.cleanup();
    await rm(folder, { recursive: true, force: true });
  }
}, 30000);

it("searches normalized names/aliases without duplicate products; preserves unknown nutrition and bounds queries", async () => {
  const repo = recipeRepository(fixture.db),
    catalog = catalogRepository(fixture.db);
  const [category] = await fixture.db
    .insert(ingredientCategories)
    .values({ name: "МОЛОЧНЫЕ ПРОДУКТЫ", slug: "dairy" })
    .returning();
  const id = await repo.saveIngredient({
    name: "  ЗЕЛЁНЫЙ\t лук  ",
    slug: "green-onion",
    nutrition: null,
  });
  await fixture.db
    .update(ingredients)
    .set({ categoryId: category.id })
    .where(eq(ingredients.id, id));
  await fixture.db.insert(ingredientAliases).values([
    { ingredientId: id, name: "Весенний лук" },
    { ingredientId: id, name: "Spring onion" },
  ]);
  expect((await catalog.search({ query: "зеленый лук" }))[0]).toMatchObject({
    ingredient: {
      id,
      normalizedName: normalizeIngredientName("  ЗЕЛЁНЫЙ\t лук  "),
    },
    nutrition: null,
  });
  expect(
    await catalog.search({
      query: "  ＳＰＲＩＮＧ  onion ",
      categoryId: category.id,
    }),
  ).toHaveLength(1);
  await expect(
    fixture.db
      .insert(ingredientAliases)
      .values({ ingredientId: id, name: "  ВЕСЕННИЙ   ЛУК " }),
  ).rejects.toThrow();
  await expect(
    fixture.db
      .insert(ingredientCategories)
      .values({ name: "молочные продукты", slug: "other-dairy" }),
  ).rejects.toThrow();
  expect(await catalog.aliases(id)).toHaveLength(2);
  expect((await catalog.listCategories())[0].id).toBe(category.id);
  expect(await catalog.search({ query: "' OR 1=1 --" })).toEqual([]);
  expect(await catalog.search({ query: "%" })).toEqual([]);
  await expect(catalog.search({ query: "", limit: 51 })).rejects.toThrow();
  await repo.saveIngredient({
    id,
    name: "Лук",
    slug: "green-onion",
    nutrition: null,
  });
  expect((await catalog.findByIds([id]))[0].ingredient.categoryId).toBe(
    category.id,
  );
});

it("retains provenance while old admin saves remain compatible, and does not expose drafts/archives", async () => {
  const repo = recipeRepository(fixture.db);
  const nutrition = {
    basisQuantity: "100",
    basisUnitId: standardUnitIds.g,
    caloriesKcal: "120",
    proteinG: "10",
    fatG: "5",
    carbohydratesG: "2",
    sourceNote: "source",
  };
  const id = await repo.saveIngredient({
    name: "Ingredient",
    slug: "v02-ingredient",
    nutrition,
  });
  await fixture.db
    .update(ingredientNutrition)
    .set({
      sourceKind: "IMPORT",
      sourceUrl: "https://example.invalid/nutrition",
      sourceIdentifier: "fixture:1",
    })
    .where(eq(ingredientNutrition.ingredientId, id));
  await repo.saveIngredient({
    id,
    name: "Ingredient",
    slug: "v02-ingredient",
    nutrition: { ...nutrition, caloriesKcal: "121" },
  });
  const input = {
    title: "v02 recipe",
    slug: "v02-recipe",
    baseServings: 4,
    status: "DRAFT",
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    ingredients: [
      { ingredientId: id, quantity: "500", unitId: standardUnitIds.g },
    ],
    steps: ["Mix"],
  };
  const recipeId = await repo.saveRecipe(input);
  expect(await resolvePublicDocuments([recipeId], repo)).toEqual([]);
  const draft = await repo.findAdminRecipe(recipeId);
  expect(() => publicRecipeDocument(draft!)).toThrow("not public");
  await repo.saveRecipe({ ...input, id: recipeId, status: "PUBLISHED" });
  const document = (await resolvePublicDocuments([recipeId], repo))[0];
  expect(document.reference).toEqual({ kind: "PUBLIC", id: recipeId });
  expect(document.ingredients[0]).toMatchObject({
    quantity: "500.000000",
    nutrition: {
      source: { kind: "IMPORT", url: "https://example.invalid/nutrition" },
      caloriesKcal: "121.000000",
    },
  });
  await repo.saveRecipe({ ...input, id: recipeId, status: "ARCHIVED" });
  expect(await resolvePublicDocuments([recipeId], repo)).toEqual([]);
});
