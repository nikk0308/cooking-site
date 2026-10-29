import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import { catalogRepository } from "@/modules/catalog/repository";

it("measures 20000 synthetic products, verifies indexed alias search, literal escaping and keyset pages", async () => {
  const f = await isolatedDatabase();
  try {
    await f.db.execute(
      sql.raw(
        "INSERT INTO ingredients(name,slug) SELECT 'Synthetic food ' || lpad(i::text,5,'0'), 'benchmark-' || i FROM generate_series(1,20000) i; INSERT INTO ingredient_aliases(ingredient_id,name) SELECT id, 'alias-' || slug FROM ingredients; ANALYZE ingredients; ANALYZE ingredient_aliases;",
      ),
    );
    const explain = async () =>
      f.pool.query(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM ingredients WHERE normalized_name LIKE $1 UNION SELECT ingredient_id FROM ingredient_aliases WHERE normalized_name LIKE $1",
        ["%alias-benchmark-19999%"],
      );
    await f.db.execute(
      sql.raw(
        "DROP INDEX ingredients_name_trgm_idx; DROP INDEX ingredient_aliases_name_trgm_idx;",
      ),
    );
    const before = (await explain()).rows[0]["QUERY PLAN"][0];
    await f.db.execute(
      sql.raw(
        "CREATE INDEX ingredients_name_trgm_idx ON ingredients USING gin(normalized_name gin_trgm_ops); CREATE INDEX ingredient_aliases_name_trgm_idx ON ingredient_aliases USING gin(normalized_name gin_trgm_ops); ANALYZE ingredients; ANALYZE ingredient_aliases;",
      ),
    );
    const after = (await explain()).rows[0]["QUERY PLAN"][0];
    console.log(
      "CATALOG_SYNTHETIC_BENCHMARK",
      JSON.stringify({
        products: 20000,
        beforeMs: before["Execution Time"],
        afterMs: after["Execution Time"],
        beforePlan: before.Plan,
        afterPlan: after.Plan,
      }),
    );
    expect(JSON.stringify(after.Plan)).toContain("Bitmap Index Scan");
    const repo = catalogRepository(f.db);
    const found = await repo.search({ query: "alias-benchmark-19999" });
    expect(found).toHaveLength(1);
    expect(found[0].ingredient.slug).toBe("benchmark-19999");
    const first = await repo.search({ query: "sy", limit: 50 });
    expect(first).toHaveLength(50);
    const last = first.at(-1)!.ingredient;
    const second = await repo.search({
      query: "sy",
      limit: 50,
      cursor: { name: last.normalizedName!, id: last.id },
    });
    expect(second).toHaveLength(50);
    expect(
      second.some((r) =>
        first.some((x) => x.ingredient.id === r.ingredient.id),
      ),
    ).toBe(false);
    for (const query of ["%", "_", "\\"])
      expect(await repo.search({ query })).toHaveLength(0);
    const prefix = await f.pool.query(
      "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM ingredients WHERE normalized_name LIKE 'synthetic food 1999%'",
    );
    expect(JSON.stringify(prefix.rows)).toContain(
      "ingredients_name_prefix_idx",
    );
  } finally {
    await f.cleanup();
  }
}, 30000);
