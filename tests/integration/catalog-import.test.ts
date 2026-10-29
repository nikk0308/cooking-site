import { beforeAll, afterAll, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import { catalogImporter } from "@/modules/catalog/importer";
import { catalogAdmin } from "@/modules/catalog/admin";
import { catalogRepository } from "@/modules/catalog/repository";
import { seedDemo } from "@/modules/recipes/seed";
import { recipeRepository } from "@/modules/recipes/repository";
import {
  catalogRevision,
  catalogSourceRecords,
  ingredientNutrition,
  ingredients,
  standardUnitIds,
} from "../../db/schema";
let fixture: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  fixture = await isolatedDatabase();
  await seedDemo(fixture.db);
});
afterAll(async () => {
  await fixture?.cleanup();
});
const record = (id: string, name = `Synthetic ${id}`) => ({
  externalId: id,
  name,
  slug: `synthetic-${id}`,
  category: null,
  aliases: [],
  nutrition: null,
});
const bytes = (records: unknown[], namespace = "synthetic-integration") =>
  new TextEncoder().encode(
    JSON.stringify({
      application: "culinote-catalog",
      schemaVersion: 1,
      namespace,
      records,
    }),
  );
it("preview is read-only; repeated import preserves UUID, aliases and timestamps", async () => {
  const service = catalogImporter(fixture.db),
    file = bytes([
      {
        ...record("one"),
        category: { name: "Synthetic category", slug: "synthetic-category" },
        aliases: ["Synthetic alternative", " Synthetic alternative "],
      },
    ]);
  const [before] = await fixture.db.select().from(catalogRevision);
  const p = await service.preview(file, "json");
  expect(p.counts.CREATE).toBe(1);
  expect(p.canApply).toBe(true);
  expect((await fixture.db.select().from(catalogRevision))[0].revision).toBe(
    before.revision,
  );
  expect((await service.preview(file, "json")).hash).toBe(p.hash);
  await service.apply(file, "json", p.hash);
  const id = p.rows[0].ingredientId!;
  const [first] = await fixture.db
    .select()
    .from(ingredients)
    .where(eq(ingredients.id, id));
  const second = await service.preview(file, "json");
  expect(second.counts.UNCHANGED).toBe(1);
  await service.apply(file, "json", second.hash);
  expect(
    (
      await fixture.db.select().from(ingredients).where(eq(ingredients.id, id))
    )[0].updatedAt,
  ).toEqual(first.updatedAt);
  expect((await catalogRepository(fixture.db).aliases(id)).length).toBe(1);
});
it("rejects duplicate IDs, slug collisions, unknown units and ambiguous names", async () => {
  const s = catalogImporter(fixture.db);
  expect(
    (await s.preview(bytes([record("dup"), record("dup")]), "json")).counts
      .CONFLICT,
  ).toBe(2);
  const same = await s.preview(
    bytes([{ ...record("two"), slug: "synthetic-one" }]),
    "json",
  );
  expect(same.canApply).toBe(false);
  const ambiguous = bytes([{ ...record("ambiguous"), name: "Synthetic one" }]);
  expect((await s.preview(ambiguous, "json")).counts.CONFLICT).toBe(1);
  const distinct = await s.preview(ambiguous, "json", {
    ambiguous: "DISTINCT",
  });
  expect(distinct.canApply).toBe(true);
  const invalid = await s.preview(
    bytes([
      {
        ...record("unit"),
        nutrition: {
          basisQuantity: "100",
          basisUnit: "invalid",
          caloriesKcal: "0",
          proteinG: "0",
          fatG: "0",
          carbohydratesG: "0",
          sourceKind: "UNKNOWN",
          sourceNote: "",
          sourceUrl: null,
          sourceIdentifier: null,
        },
      },
    ]),
    "json",
  );
  expect(invalid.counts.INVALID).toBe(1);
});
it("stale preview fails after direct SQL or concurrent imports", async () => {
  const s = catalogImporter(fixture.db),
    a = bytes([record("concurrent-a")]),
    b = bytes([record("concurrent-b")]);
  const pa = await s.preview(a, "json"),
    pb = await s.preview(b, "json");
  const results = await Promise.allSettled([
    s.apply(a, "json", pa.hash),
    s.apply(b, "json", pb.hash),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const p = await s.preview(bytes([record("stale")]), "json");
  await fixture.db
    .update(ingredients)
    .set({ updatedAt: new Date() })
    .where(eq(ingredients.id, pa.rows[0].ingredientId!));
  await expect(
    s.apply(bytes([record("stale")]), "json", p.hash),
  ).rejects.toThrow("STALE_PLAN");
});
it("rollback preserves all previous data when a later row fails", async () => {
  const s = catalogImporter(fixture.db),
    file = bytes([record("rollback-a"), record("rollback-b")]);
  const p = await s.preview(file, "json");
  await fixture.db.execute(
    sql.raw(
      `CREATE FUNCTION test_reject_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.slug = 'synthetic-rollback-b' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_import BEFORE INSERT ON ingredients FOR EACH ROW EXECUTE FUNCTION test_reject_import();`,
    ),
  );
  try {
    await expect(s.apply(file, "json", p.hash)).rejects.toThrow();
    expect(
      await fixture.db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, p.rows[0].ingredientId!)),
    ).toHaveLength(0);
    expect(
      await fixture.db
        .select()
        .from(catalogSourceRecords)
        .where(eq(catalogSourceRecords.externalId, "rollback-a")),
    ).toHaveLength(0);
  } finally {
    await fixture.db.execute(
      sql.raw(
        "DROP TRIGGER test_reject_import ON ingredients; DROP FUNCTION test_reject_import();",
      ),
    );
  }
  const retry = await s.preview(file, "json");
  await s.apply(file, "json", retry.hash);
  expect((await s.preview(file, "json")).counts.UNCHANGED).toBe(2);
});
it("manual editing preserves provenance; import requires explicit replacement; removing nutrition requires confirmation", async () => {
  const admin = catalogAdmin(fixture.db),
    s = catalogImporter(fixture.db);
  const file = bytes([
    {
      ...record("nutrition"),
      nutrition: {
        basisQuantity: "1",
        basisUnit: "g",
        caloriesKcal: "0",
        proteinG: "0",
        fatG: "0",
        carbohydratesG: "0",
        sourceKind: "IMPORT",
        sourceNote: "Synthetic fixture, not reference nutrition",
        sourceUrl: "https://example.invalid/fixture",
        sourceIdentifier: "fixture:1",
      },
    },
  ]);
  const p = await s.preview(file, "json");
  await s.apply(file, "json", p.hash);
  const id = p.rows[0].ingredientId!;
  await admin.save({
    id,
    name: "Manual correction",
    slug: "synthetic-nutrition",
    aliases: ["manual alias"],
  });
  const [n] = await fixture.db
    .select()
    .from(ingredientNutrition)
    .where(eq(ingredientNutrition.ingredientId, id));
  expect(n.sourceIdentifier).toBe("fixture:1");
  expect(n.basisUnitId).toBe(standardUnitIds.g);
  expect((await s.preview(file, "json")).counts.CONFLICT).toBe(1);
  const kept = await s.preview(file, "json", { nutrition: "KEEP" });
  await s.apply(file, "json", kept.hash, { nutrition: "KEEP" });
  expect((await admin.get(id))?.name).toBe("Manual correction");
  const replaced = await s.preview(file, "json", { nutrition: "REPLACE" });
  await s.apply(file, "json", replaced.hash, { nutrition: "REPLACE" });
  await expect(
    admin.save({
      id,
      name: "Synthetic nutrition",
      slug: "synthetic-nutrition",
      nutrition: null,
    }),
  ).rejects.toThrow();
  await admin.save({
    id,
    name: "Synthetic nutrition",
    slug: "synthetic-nutrition",
    nutrition: null,
    removeNutrition: true,
  });
  expect((await admin.get(id))?.nutrition).toBeNull();
});
it("explicit linking does not adopt or overwrite manual product nutrition", async () => {
  const admin = catalogAdmin(fixture.db),
    s = catalogImporter(fixture.db);
  const manual = await admin.save({
    name: "Link candidate",
    slug: "link-candidate",
  });
  const file = bytes([{ ...record("linked"), name: "Link candidate" }]);
  const d = { linked: { link: manual.id } };
  const p = await s.preview(file, "json", d);
  expect(p.canApply).toBe(true);
  await s.apply(file, "json", p.hash, d);
  expect((await admin.get(manual.id))?.slug).toBe("link-candidate");
  expect((await s.preview(file, "json")).counts.UNCHANGED).toBe(1);
});
it("categories reject normalized duplicates and refuse deleting used categories", async () => {
  const admin = catalogAdmin(fixture.db);
  const c = await admin.saveCategory({ name: "Ёж", slug: "hedgehog" });
  await expect(
    admin.saveCategory({ name: "еж", slug: "another-hedgehog" }),
  ).rejects.toThrow();
  const i = await admin.save({
    name: "Category fixture",
    slug: "category-fixture",
    categoryId: c.id,
  });
  await expect(admin.removeCategory(c.id)).rejects.toThrow();
  await admin.save({ id: i.id, name: i.name, slug: i.slug, categoryId: null });
  await admin.removeCategory(c.id);
});

it("alias rename preserves UUID; duplicate aliases and stale forms preserve saved state", async () => {
  const admin = catalogAdmin(fixture.db),
    repo = catalogRepository(fixture.db);
  const ingredient = await admin.save({
    name: "Alias stability",
    slug: "alias-stability",
    aliases: ["Initial alias", "Removed alias"],
  });
  const original = await repo.aliases(ingredient.id),
    stale = await admin.get(ingredient.id);
  await admin.save({
    id: ingredient.id,
    name: ingredient.name,
    slug: ingredient.slug,
    aliases: ["INITIAL alias", "New alias"],
  });
  expect(
    (await repo.aliases(ingredient.id)).find((a) => a.name === "INITIAL alias")
      ?.id,
  ).toBe(original.find((a) => a.name === "Initial alias")?.id);
  await expect(
    admin.save({ ...stale!, aliases: ["overwrite attempt"] }),
  ).rejects.toThrow("изменена");
  await expect(
    admin.save({
      id: ingredient.id,
      name: ingredient.name,
      slug: ingredient.slug,
      aliases: ["Ёж", "еж"],
    }),
  ).rejects.toThrow();
  expect(await repo.aliases(ingredient.id)).toHaveLength(2);
});

it("imported UUID remains a valid public recipe FK and catalog search identity", async () => {
  const service = catalogImporter(fixture.db),
    file = bytes([record("public-recipe")]);
  const p = await service.preview(file, "json");
  await service.apply(file, "json", p.hash);
  const repo = recipeRepository(fixture.db),
    ingredientId = p.rows[0].ingredientId!;
  const id = await repo.saveRecipe({
    title: "Synthetic imported recipe",
    slug: "synthetic-imported-recipe",
    baseServings: 4,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    status: "PUBLISHED",
    ingredients: [
      { ingredientId, quantity: "123.000001", unitId: standardUnitIds.g },
    ],
    steps: ["Synthetic test step"],
  });
  const recipe = await repo.findAdminRecipe(id);
  expect(recipe?.ingredients[0].line.ingredientId).toBe(ingredientId);
  expect(recipe?.ingredients[0].line.quantity).toBe("123.000001");
  const unchanged = await service.preview(file, "json");
  await service.apply(file, "json", unchanged.hash);
  expect(
    (await repo.findAdminRecipe(id))?.ingredients[0].line.ingredientId,
  ).toBe(ingredientId);
});
