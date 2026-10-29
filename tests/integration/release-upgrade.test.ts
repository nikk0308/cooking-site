import { it, expect } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { isolatedDatabase } from "../helpers/database";
import { legacyMigrations } from "../helpers/legacy-migrations";
import { v01Tables, inventory } from "../../scripts/backup/inventory";
it("v0.1 full data/session/publication upgrade is preserved; failed upgrade rolls back and cannot publish a false ledger", async () => {
  const legacy = await legacyMigrations(),
    f = await isolatedDatabase(legacy.root);
  try {
    const ingredient = (
      await f.pool.query(
        "INSERT INTO ingredients(name,slug) VALUES('Synthetic legacy','synthetic-legacy') RETURNING id",
      )
    ).rows[0].id;
    await f.pool.query(
      "INSERT INTO ingredient_nutrition(ingredient_id,basis_quantity,basis_unit_id,calories_kcal,protein_g,fat_g,carbohydrates_g) VALUES($1,'100.000001','10000000-0000-4000-8000-000000000001','12.123456',0,0,0)",
      [ingredient],
    );
    const admin = (
      await f.pool.query(
        "INSERT INTO admin_users(email,password_hash) VALUES('synthetic@example.invalid','synthetic-nonlogin-hash') RETURNING id",
      )
    ).rows[0].id;
    await f.pool.query(
      "INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at) VALUES($1,$2,'2030-01-01Z')",
      [admin, "a".repeat(64)],
    );
    const asset = (
      await f.pool.query(
        "INSERT INTO media(storage_key,mime_type,width,height,size_bytes,sha256) VALUES('70000000-0000-4000-8000-000000000001.webp','image/webp',1,1,10,$1) RETURNING id",
        ["b".repeat(64)],
      )
    ).rows[0].id;
    for (const status of ["PUBLISHED", "DRAFT", "ARCHIVED"]) {
      const recipe = (
        await f.pool.query(
          "INSERT INTO recipes(title,slug,base_servings,status,cover_media_id,published_at) VALUES($1,$2,4,$3::recipe_status,$4,CASE WHEN $3::recipe_status='PUBLISHED' THEN now() ELSE NULL END) RETURNING id",
          [
            "Synthetic " + status,
            "synthetic-" + status.toLowerCase(),
            status,
            asset,
          ],
        )
      ).rows[0].id;
      await f.pool.query(
        "INSERT INTO recipe_ingredients(recipe_id,ingredient_id,quantity,unit_id,position) VALUES($1,$2,'0.000001','10000000-0000-4000-8000-000000000001',1)",
        [recipe, ingredient],
      );
      await f.pool.query(
        "INSERT INTO recipe_steps(recipe_id,position,instruction) VALUES($1,1,'Synthetic legacy step')",
        [recipe],
      );
    }
    const before = new Map<string, string>();
    for (const table of v01Tables)
      before.set(
        table,
        JSON.stringify(
          (
            await f.pool.query(
              `SELECT to_jsonb(t)::text AS value FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
        ),
      );
    await f.pool.query("CREATE TABLE catalog_revision(id integer)");
    await expect(
      migrate(f.db, { migrationsFolder: "db/migrations" }),
    ).rejects.toThrow();
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::integer n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await f.pool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='ingredients' AND column_name='category_id'",
        )
      ).rows,
    ).toHaveLength(0);
    await f.pool.query("DROP TABLE catalog_revision");
    await migrate(f.db, { migrationsFolder: "db/migrations" });
    await migrate(f.db, { migrationsFolder: "db/migrations" });
    // New ingredient/nutrition columns are additive; compare the original fields exactly.
    for (const table of v01Tables) {
      const selection =
        table === "ingredients"
          ? "SELECT id,name,slug,created_at,updated_at FROM ingredients"
          : table === "ingredient_nutrition"
            ? "SELECT ingredient_id,basis_quantity,basis_unit_id,calories_kcal,protein_g,fat_g,carbohydrates_g,source_note,created_at,updated_at FROM ingredient_nutrition"
            : `SELECT * FROM "${table}"`;
      const after = (
        await f.pool.query(
          `SELECT to_jsonb(t)::text AS value FROM (${selection}) t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
      expect(JSON.stringify(after)).toBe(before.get(table));
    }
    const client = await f.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const upgraded = await inventory(client, "v0.2");
      expect(upgraded.schema.tables).toHaveLength(14);
      expect(upgraded.schema.triggers).toHaveLength(6);
      expect(upgraded.schema.migrations).toHaveLength(4);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  } finally {
    await f.cleanup();
    await legacy.cleanup();
  }
}, 30000);
