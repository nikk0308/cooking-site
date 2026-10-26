import path from "node:path";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standardUnitIds } from "../../db/schema/units";
import { standardUnits } from "@/modules/units/unit";
import { parseDecimal } from "@/shared/decimal/decimal";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl)
  throw new Error("DATABASE_URL is required for PostgreSQL integration");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const databaseNames = [
  `recipes_phase4_a_${suffix}`,
  `recipes_phase4_b_${suffix}`,
];
let adminPool: Pool | undefined;
const databasePools: Pool[] = [];

function databaseUrl(name: string): string {
  const url = new URL(sourceUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function expectConstraint(query: Promise<unknown>): Promise<void> {
  await expect(query).rejects.toMatchObject({ code: expect.any(String) });
}

describe("Phase 4 PostgreSQL domain schema", () => {
  beforeAll(async () => {
    const adminUrl = new URL(sourceUrl!);
    adminUrl.pathname = "/postgres";
    adminPool = new Pool({ connectionString: adminUrl.toString() });
    for (const name of databaseNames) {
      // Names contain only this harness's fixed prefix and random lowercase hex.
      await adminPool.query(`CREATE DATABASE "${name}"`);
      const pool = new Pool({ connectionString: databaseUrl(name) });
      databasePools.push(pool);
      await migrate(drizzle(pool), {
        migrationsFolder: path.resolve("db/migrations"),
      });
    }
  }, 30_000);

  afterAll(async () => {
    for (const pool of databasePools) await pool.end();
    if (adminPool) {
      for (const name of databaseNames)
        await adminPool.query(`DROP DATABASE IF EXISTS "${name}"`);
      await adminPool.end();
    }
  });

  it("applies reproducibly to two clean databases and seeds units idempotently", async () => {
    for (const pool of databasePools) {
      const tables = await pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "admin_sessions",
        "admin_users",
        "ingredient_nutrition",
        "ingredients",
        "media",
        "recipe_ingredients",
        "recipe_steps",
        "recipes",
        "units",
      ]);
      const units = await pool.query<{
        id: string;
        code: keyof typeof standardUnits;
        name: string;
        symbol: string;
        dimension: string;
        factor_to_base: string;
      }>(
        "SELECT id, code, name, symbol, dimension, factor_to_base FROM units ORDER BY code",
      );
      expect(units.rows.map((unit) => unit.code).sort()).toEqual(
        Object.keys(standardUnits).sort(),
      );
      for (const unit of units.rows) {
        const domainUnit = standardUnits[unit.code];
        expect(unit.id).toBe(standardUnitIds[unit.code]);
        expect({
          name: unit.name,
          symbol: unit.symbol,
          dimension: unit.dimension,
        }).toEqual({
          name: domainUnit.name,
          symbol: domainUnit.symbol,
          dimension: domainUnit.dimension,
        });
        expect(
          parseDecimal(unit.factor_to_base).equals(domainUnit.factorToBase),
        ).toBe(true);
      }
      await migrate(drizzle(pool), {
        migrationsFolder: path.resolve("db/migrations"),
      });
      expect(
        (await pool.query("SELECT count(*)::int AS count FROM units")).rows[0],
      ).toEqual({ count: 7 });
    }
  });

  it("persists conversion factors and domain values at their contracted precision", async () => {
    const metadata = await databasePools[0].query<{
      table_name: string;
      column_name: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `SELECT table_name, column_name, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('units', 'factor_to_base'),
           ('recipe_ingredients', 'quantity'),
           ('ingredient_nutrition', 'basis_quantity'),
           ('ingredient_nutrition', 'calories_kcal'),
           ('ingredient_nutrition', 'protein_g'),
           ('ingredient_nutrition', 'fat_g'),
           ('ingredient_nutrition', 'carbohydrates_g')
         )`,
    );
    const precision = new Map(
      metadata.rows.map((column) => [
        `${column.table_name}.${column.column_name}`,
        [column.numeric_precision, column.numeric_scale],
      ]),
    );
    expect(precision.get("units.factor_to_base")).toEqual([24, 12]);
    for (const column of [
      "recipe_ingredients.quantity",
      "ingredient_nutrition.basis_quantity",
      "ingredient_nutrition.calories_kcal",
      "ingredient_nutrition.protein_g",
      "ingredient_nutrition.fat_g",
      "ingredient_nutrition.carbohydrates_g",
    ]) {
      expect(precision.get(column)).toEqual([18, 6]);
    }
  });

  it("enforces unique identities and positions", async () => {
    const pool = databasePools[0];
    await expectConstraint(
      pool.query(
        "INSERT INTO units (code, name, symbol, dimension, factor_to_base) VALUES ('g', 'duplicate', 'g', 'MASS', 1)",
      ),
    );
    const ingredient = (
      await pool.query<{ id: string }>(
        "INSERT INTO ingredients (name, slug) VALUES ($1, $2) RETURNING id",
        ["Мука", `flour-${suffix}`],
      )
    ).rows[0];
    await expectConstraint(
      pool.query("INSERT INTO ingredients (name, slug) VALUES ($1, $2)", [
        "Другая мука",
        `flour-${suffix}`,
      ]),
    );
    const recipe = (
      await pool.query<{ id: string }>(
        "INSERT INTO recipes (title, slug, base_servings) VALUES ($1, $2, 4) RETURNING id",
        ["Тесто", `dough-${suffix}`],
      )
    ).rows[0];
    await expectConstraint(
      pool.query(
        "INSERT INTO recipes (title, slug, base_servings) VALUES ($1, $2, 2)",
        ["Другое тесто", `dough-${suffix}`],
      ),
    );
    await pool.query(
      "INSERT INTO recipe_steps (recipe_id, position, instruction) VALUES ($1, 1, $2)",
      [recipe.id, "Смешать"],
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_steps (recipe_id, position, instruction) VALUES ($1, 1, $2)",
        [recipe.id, "Повтор"],
      ),
    );
    const gramId = (
      await pool.query<{ id: string }>("SELECT id FROM units WHERE code = 'g'")
    ).rows[0].id;
    await pool.query(
      "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, position) VALUES ($1, $2, '100', $3, 1)",
      [recipe.id, ingredient.id, gramId],
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, position) VALUES ($1, $2, '50', $3, 1)",
        [recipe.id, ingredient.id, gramId],
      ),
    );
    await pool.query(
      "INSERT INTO ingredient_nutrition (ingredient_id, basis_quantity, basis_unit_id, calories_kcal, protein_g, fat_g, carbohydrates_g) VALUES ($1, '100', $2, '364', '10', '1', '76')",
      [ingredient.id, gramId],
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO ingredient_nutrition (ingredient_id, basis_quantity, basis_unit_id, calories_kcal, protein_g, fat_g, carbohydrates_g) VALUES ($1, '100', $2, '364', '10', '1', '76')",
        [ingredient.id, gramId],
      ),
    );
  });

  it("enforces positive, non-negative, publication, unit, and FK checks", async () => {
    const pool = databasePools[0];
    await expectConstraint(
      pool.query(
        "INSERT INTO recipes (title, slug, base_servings) VALUES ('Bad', $1, 0)",
        [`bad-servings-${suffix}`],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipes (title, slug, base_servings, status) VALUES ('Bad', $1, 1, 'PUBLISHED')",
        [`bad-published-${suffix}`],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO units (code, name, symbol, dimension, factor_to_base) VALUES ($1, 'bad', 'bad', 'MASS', NULL)",
        [`bad-unit-${suffix}`],
      ),
    );
    const gramId = (
      await pool.query<{ id: string }>("SELECT id FROM units WHERE code = 'g'")
    ).rows[0].id;
    const ingredient = (
      await pool.query<{ id: string }>(
        "INSERT INTO ingredients (name, slug) VALUES ('Test', $1) RETURNING id",
        [`checks-${suffix}`],
      )
    ).rows[0];
    const recipe = (
      await pool.query<{ id: string }>(
        "INSERT INTO recipes (title, slug, base_servings) VALUES ('Test', $1, 1) RETURNING id",
        [`checks-${suffix}`],
      )
    ).rows[0];
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, position) VALUES ($1, $2, 0, $3, 1)",
        [recipe.id, ingredient.id, gramId],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, position) VALUES ($1, $2, 1, $3, 0)",
        [recipe.id, ingredient.id, gramId],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_steps (recipe_id, position, instruction) VALUES ($1, 1, '   ')",
        [recipe.id],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO ingredient_nutrition (ingredient_id, basis_quantity, basis_unit_id, calories_kcal, protein_g, fat_g, carbohydrates_g) VALUES ($1, 100, $2, -1, 0, 0, 0)",
        [ingredient.id, gramId],
      ),
    );
    await expectConstraint(
      pool.query(
        "INSERT INTO recipe_steps (recipe_id, position, instruction) VALUES ($1, 1, 'x')",
        [randomUUID()],
      ),
    );
  });

  it("cascades recipe-owned rows, restricts shared references, and cascades nutrition", async () => {
    const pool = databasePools[0];
    const gramId = (
      await pool.query<{ id: string }>("SELECT id FROM units WHERE code = 'g'")
    ).rows[0].id;
    const ingredient = (
      await pool.query<{ id: string }>(
        "INSERT INTO ingredients (name, slug) VALUES ('Owned test', $1) RETURNING id",
        [`owned-${suffix}`],
      )
    ).rows[0];
    const recipe = (
      await pool.query<{ id: string }>(
        "INSERT INTO recipes (title, slug, base_servings) VALUES ('Owned', $1, 1) RETURNING id",
        [`owned-${suffix}`],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO recipe_steps (recipe_id, position, instruction) VALUES ($1, 1, 'step')",
      [recipe.id],
    );
    await pool.query(
      "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit_id, position) VALUES ($1, $2, 1, $3, 1)",
      [recipe.id, ingredient.id, gramId],
    );
    await expectConstraint(
      pool.query("DELETE FROM ingredients WHERE id = $1", [ingredient.id]),
    );
    await expectConstraint(
      pool.query("DELETE FROM units WHERE id = $1", [gramId]),
    );
    await pool.query("DELETE FROM recipes WHERE id = $1", [recipe.id]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM recipe_steps WHERE recipe_id = $1",
          [recipe.id],
        )
      ).rows[0],
    ).toEqual({ count: 0 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM recipe_ingredients WHERE recipe_id = $1",
          [recipe.id],
        )
      ).rows[0],
    ).toEqual({ count: 0 });
    await pool.query(
      "INSERT INTO ingredient_nutrition (ingredient_id, basis_quantity, basis_unit_id, calories_kcal, protein_g, fat_g, carbohydrates_g) VALUES ($1, 100, $2, 1, 1, 1, 1)",
      [ingredient.id, gramId],
    );
    await pool.query("DELETE FROM ingredients WHERE id = $1", [ingredient.id]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM ingredient_nutrition WHERE ingredient_id = $1",
          [ingredient.id],
        )
      ).rows[0],
    ).toEqual({ count: 0 });
  });
});
