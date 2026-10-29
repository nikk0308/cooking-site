import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { isolatedDatabase } from "../helpers/database";
import { seedDemo } from "@/modules/recipes/seed";
import { hashPassword, hashSessionToken } from "@/modules/admin/crypto";
import { adminUsers, adminSessions, media, recipes } from "../../db/schema";
import { catalogImporter } from "@/modules/catalog/importer";
import { catalogAdmin } from "@/modules/catalog/admin";
import { recipeRepository } from "@/modules/recipes/repository";
import { inventory, digest } from "../../scripts/backup/inventory";
import type { Pool } from "pg";
import type { ReleasePolicy } from "../../scripts/backup/guard";
export const protectedPoint = "20261027T155249Z-012c8349-1a6e2ddc5110";
export const testSha = process.env.GITHUB_SHA ?? "a".repeat(40);
export async function state(pool: Pool, version: "v0.1" | "v0.2" = "v0.2") {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    return await inventory(c, version);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
export async function fixture() {
  if (!process.env.BACKUP_TEST_PG_CONTAINER)
    throw new Error("Explicit isolated BACKUP_TEST_PG_CONTAINER required");
  const db = await isolatedDatabase(),
    root = await mkdtemp(path.join(os.tmpdir(), "culinote-recovery-")),
    mediaRoot = path.join(root, "source-media");
  await mkdir(mediaRoot, { mode: 0o700 });
  await seedDemo(db.db);
  const file = new TextEncoder().encode(
    JSON.stringify({
      application: "culinote-catalog",
      schemaVersion: 1,
      namespace: "synthetic-release",
      batch: "part-001",
      records: [
        {
          externalId: "synthetic-1",
          name: "Synthetic recovery product",
          slug: "synthetic-recovery-product",
          category: {
            name: "Synthetic recovery category",
            slug: "synthetic-recovery-category",
          },
          aliases: ["Recovery alias"],
          nutrition: {
            basisQuantity: "0.5",
            basisUnit: "kg",
            caloriesKcal: "12.123456",
            proteinG: "0",
            fatG: "0",
            carbohydratesG: "0.000001",
            sourceKind: "IMPORT",
            sourceNote: "Synthetic validation only; not reference nutrition",
            sourceUrl: "https://example.invalid/synthetic",
            sourceIdentifier: "synthetic:1",
          },
        },
      ],
    }),
  );
  const importer = catalogImporter(db.db),
    plan = await importer.preview(file, "json");
  await importer.apply(file, "json", plan.hash);
  const ingredientId = plan.rows[0].ingredientId!;
  const unknown = await catalogAdmin(db.db).save({
    name: "Synthetic unknown nutrition",
    slug: "synthetic-unknown",
    nutrition: null,
  });
  await recipeRepository(db.db).saveRecipe({
    title: "Synthetic draft",
    slug: "synthetic-draft",
    baseServings: 4,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    status: "DRAFT",
    ingredients: [
      {
        ingredientId: unknown.id,
        quantity: "123.123456",
        unitId: "10000000-0000-4000-8000-000000000001",
      },
    ],
    steps: ["Synthetic step"],
  });
  const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#557755" },
    })
      .webp()
      .toBuffer(),
    key = randomUUID() + ".webp";
  await writeFile(path.join(mediaRoot, key), image, { mode: 0o600 });
  const [asset] = await db.db
    .insert(media)
    .values({
      storageKey: key,
      mimeType: "image/webp",
      width: 16,
      height: 16,
      sizeBytes: image.length,
      sha256: digest(image),
    })
    .returning();
  await db.db
    .update(recipes)
    .set({ coverMediaId: asset.id })
    .where(eq(recipes.slug, "syrniki"));
  const password = randomBytes(24).toString("hex"),
    email = "synthetic-recovery@example.invalid";
  const [admin] = await db.db
    .insert(adminUsers)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning();
  await db.db.insert(adminSessions).values({
    adminUserId: admin.id,
    tokenHash: hashSessionToken(randomBytes(32).toString("hex")),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const initial = await state(db.pool),
    policy: ReleasePolicy = {
      format: 1,
      toolSha: testSha,
      protectedRecoverySnapshot: protectedPoint,
      rules: [
        {
          runtimeSha: testSha,
          schemaHash: initial.schemaHash,
          inventoryVersion: "v0.2",
        },
      ],
    };
  const options = {
    pool: db.pool,
    container: process.env.BACKUP_TEST_PG_CONTAINER!,
    database: new URL(db.url).pathname.slice(1),
    user: new URL(db.url).username,
    mediaRoot,
    destination: path.join(root, "backup"),
    version: "v0.2" as const,
    runtime: { sha: testSha, image: "sha256:" + "a".repeat(64) },
    toolSha: testSha,
    policy,
  };
  return {
    db,
    root,
    mediaRoot,
    ingredientId,
    file,
    policy,
    options,
    email,
    password,
    initial,
    async cleanup() {
      await db.cleanup();
      const target = await realpath(root);
      if (
        path.dirname(target) !== (await realpath(os.tmpdir())) ||
        !path.basename(target).startsWith("culinote-recovery-")
      )
        throw new Error("Unsafe test recovery cleanup");
      await rm(target, { recursive: true, force: true });
    },
  };
}
