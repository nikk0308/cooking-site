import { it, expect } from "vitest";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import {
  ingredientCategories,
  ingredientAliases,
  ingredientNutrition,
  ingredients,
  standardUnitIds,
} from "../../db/schema";

it("upgrades populated 0002 catalog to 0003 without changing UUID, aliases, provenance, recipes or FKs; repeat is no-op", async () => {
  const folder = await mkdtemp(
    path.join(os.tmpdir(), "culinote-p67-migrations-"),
  );
  let f: Awaited<ReturnType<typeof isolatedDatabase>> | undefined;
  try {
    await mkdir(path.join(folder, "meta"));
    const journal = JSON.parse(
      await readFile("db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.idx < 3);
    await writeFile(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const e of journal.entries)
      await copyFile(
        `db/migrations/${e.tag}.sql`,
        path.join(folder, `${e.tag}.sql`),
      );
    f = await isolatedDatabase(folder);
    const [category] = await f.db
      .insert(ingredientCategories)
      .values({ name: "Existing category", slug: "existing-category" })
      .returning();
    const [product] = await f.db
      .insert(ingredients)
      .values({
        name: "Existing product",
        slug: "existing-product",
        categoryId: category.id,
      })
      .returning();
    const [alias] = await f.db
      .insert(ingredientAliases)
      .values({ name: "Existing alias", ingredientId: product.id })
      .returning();
    const [nutrition] = await f.db
      .insert(ingredientNutrition)
      .values({
        ingredientId: product.id,
        basisQuantity: "0.5",
        basisUnitId: standardUnitIds.kg,
        caloriesKcal: "1.125",
        proteinG: "0",
        fatG: "0",
        carbohydratesG: "0",
        sourceKind: "REFERENCE",
        sourceIdentifier: "synthetic-preservation-test",
        sourceNote: "Synthetic only",
      })
      .returning();
    const legacyRecipe = (
      await f.pool.query(
        "INSERT INTO recipes(title,slug,base_servings,status,published_at) VALUES ('Synthetic legacy','synthetic-legacy',4,'PUBLISHED',now()) RETURNING id",
      )
    ).rows[0];
    await f.pool.query(
      "INSERT INTO recipe_ingredients(recipe_id,ingredient_id,quantity,unit_id,position) VALUES ($1,$2,'125.123456',$3,1)",
      [legacyRecipe.id, product.id, standardUnitIds.g],
    );
    const recipesBefore = await f.pool.query(
      "SELECT * FROM recipes ORDER BY id",
    );
    const linesBefore = await f.pool.query(
      "SELECT * FROM recipe_ingredients ORDER BY id",
    );
    await migrate(f.db, { migrationsFolder: "db/migrations" });
    await migrate(f.db, { migrationsFolder: "db/migrations" });
    expect(
      (
        await f.db
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, product.id))
      )[0],
    ).toEqual(product);
    expect(
      (
        await f.db
          .select()
          .from(ingredientAliases)
          .where(eq(ingredientAliases.id, alias.id))
      )[0],
    ).toEqual(alias);
    expect(
      (
        await f.db
          .select()
          .from(ingredientNutrition)
          .where(eq(ingredientNutrition.ingredientId, product.id))
      )[0],
    ).toEqual(nutrition);
    expect(
      (await f.pool.query("SELECT * FROM recipes ORDER BY id")).rows,
    ).toEqual(recipesBefore.rows);
    expect(
      (await f.pool.query("SELECT * FROM recipe_ingredients ORDER BY id")).rows,
    ).toEqual(linesBefore.rows);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::integer n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0].n,
    ).toBe(4);
  } finally {
    await f?.cleanup();
    const target = path.resolve(folder);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("culinote-p67-migrations-")
    )
      throw new Error("Unexpected temporary path");
    await rm(target, { recursive: true, force: true });
  }
});
