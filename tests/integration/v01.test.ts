import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import { recipeRepository } from "@/modules/recipes/repository";
import { seedDemo } from "@/modules/recipes/seed";
import { resolveBasket } from "@/modules/basket/service";
import {
  storeImage,
  mediaPath,
  checkMediaStorage,
} from "@/modules/media/storage";
import {
  adminUsers,
  adminSessions,
  media,
  recipes,
  standardUnitIds,
} from "../../db/schema";
let fixture: Awaited<ReturnType<typeof isolatedDatabase>>, root: string;
beforeAll(async () => {
  fixture = await isolatedDatabase();
  root = await mkdtemp(path.join(os.tmpdir(), "recipes-integration-media-"));
  process.env.MEDIA_ROOT = root;
}, 30000);
afterAll(async () => {
  await fixture?.cleanup();
  if (root) await rm(root, { recursive: true, force: true });
  delete process.env.MEDIA_ROOT;
});
it("seeds six recipes reproducibly without overwriting existing data", async () => {
  await seedDemo(fixture.db);
  await seedDemo(fixture.db);
  expect(
    await recipeRepository(fixture.db).listPublishedRecipes(),
  ).toHaveLength(6);
});
it("enforces admin uniqueness, session FK and revocation representation", async () => {
  const [admin] = await fixture.db
    .insert(adminUsers)
    .values({
      email: "test@example.invalid",
      passwordHash: "test-only-encoded-placeholder",
    })
    .returning();
  await expect(
    fixture.db
      .insert(adminUsers)
      .values({ email: admin.email, passwordHash: "unused" }),
  ).rejects.toThrow();
  await expect(
    fixture.db.insert(adminSessions).values({
      adminUserId: randomUUID(),
      tokenHash: "a".repeat(64),
      expiresAt: new Date(),
    }),
  ).rejects.toThrow();
  const [session] = await fixture.db
    .insert(adminSessions)
    .values({
      adminUserId: admin.id,
      tokenHash: "b".repeat(64),
      expiresAt: new Date(0),
      revokedAt: new Date(0),
    })
    .returning();
  expect(session.expiresAt.getTime()).toBe(0);
  expect(session.revokedAt).not.toBeNull();
  await fixture.db.delete(adminUsers).where(eq(adminUsers.id, admin.id));
  expect(await fixture.db.select().from(adminSessions)).toHaveLength(0);
});
it("creates and updates transactionally, rolls back failed child writes, preserves publication time", async () => {
  const repo = recipeRepository(fixture.db);
  const ingredient = (await repo.listIngredients())[0].ingredient;
  const input = {
    title: "Тест",
    slug: "transaction-test",
    baseServings: 4,
    status: "DRAFT",
    prepTimeMinutes: 0,
    cookTimeMinutes: 0,
    ingredients: [
      {
        ingredientId: ingredient.id,
        quantity: "500",
        unitId: standardUnitIds.g,
      },
    ],
    steps: ["Смешать"],
  };
  const id = await repo.saveRecipe(input);
  expect(await repo.findPublishedRecipeBySlug(input.slug)).toBeUndefined();
  expect(await repo.resolvePublishedRecipes([id])).toEqual([]);
  await expect(
    repo.saveRecipe({
      ...input,
      id,
      title: "Should roll back",
      ingredients: [{ ...input.ingredients[0], ingredientId: randomUUID() }],
    }),
  ).rejects.toThrow();
  expect((await repo.findAdminRecipe(id))?.title).toBe("Тест");
  await repo.saveRecipe({ ...input, id, status: "PUBLISHED" });
  const published = await repo.findPublishedRecipeBySlug(input.slug);
  expect(published?.ingredients[0].line.quantity).toBe("500.000000");
  await repo.saveRecipe({
    ...input,
    id,
    status: "PUBLISHED",
    title: "Изменён",
  });
  expect((await repo.findAdminRecipe(id))?.publishedAt).toEqual(
    published?.publishedAt,
  );
  await repo.saveRecipe({ ...input, id, status: "ARCHIVED" });
  expect(await repo.findPublishedRecipeBySlug(input.slug)).toBeUndefined();
  const result = await resolveBasket(
    {
      schemaVersion: 1,
      items: [
        {
          recipeId: id,
          selectedServings: 6,
          addedAt: new Date().toISOString(),
          schemaVersion: 1,
        },
      ],
    },
    repo,
  );
  expect(result.items[0].slug).toBeNull();
  expect(result.ingredients).toEqual([]);
});
it("normalizes media, checks writable storage and sets cover FK to null without deleting shared records", async () => {
  const input = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#448855" },
  })
    .png()
    .toBuffer();
  const image = await storeImage(input);
  expect(image.storageKey).toMatch(/^[a-f0-9-]+\.webp$/);
  expect(
    (await sharp(await readFile(mediaPath(root, image.storageKey))).metadata())
      .format,
  ).toBe("webp");
  await checkMediaStorage();
  expect(await readdir(root)).toEqual([image.storageKey]);
  await expect(storeImage(Buffer.from("<svg/>"))).rejects.toThrow();
  await expect(
    storeImage(new Uint8Array(10 * 1024 * 1024 + 1)),
  ).rejects.toThrow();
  const [m] = await fixture.db.insert(media).values(image).returning();
  const recipe = (await recipeRepository(fixture.db).listPublishedRecipes())[0];
  await fixture.db
    .update(recipes)
    .set({ coverMediaId: m.id })
    .where(eq(recipes.id, recipe.id));
  await fixture.db.delete(media).where(eq(media.id, m.id));
  expect(
    (await recipeRepository(fixture.db).findAdminRecipe(recipe.id))
      ?.coverMediaId,
  ).toBeNull();
});
