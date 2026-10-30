import { beforeAll, afterAll, it, expect } from "vitest";
import { cp, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { fixture, state, testSha, protectedPoint } from "./fixture";
import { isolatedDatabase } from "../helpers/database";
import { legacyMigrations } from "../helpers/legacy-migrations";
import {
  captureBackup,
  restoreBackup,
  loadBackup,
} from "../../scripts/backup/archive";
import {
  validateInventory,
  validateSchema,
  canonical,
  digest,
  comparableInventory,
} from "../../scripts/backup/inventory";
import {
  checkBinding,
  checkGuard,
  type ReleasePolicy,
} from "../../scripts/backup/guard";
import { catalogImporter } from "@/modules/catalog/importer";
import { recipeRepository } from "@/modules/recipes/repository";
import { ingredientNutrition, standardUnitIds } from "../../db/schema";
let source: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  source = await fixture();
  await captureBackup(source.options);
}, 60000);
afterAll(async () => {
  await source?.cleanup();
});
it("full synthetic pg_dump/media restore preserves schema, rows, UUIDs, provenance, receipts and working triggers", async () => {
  const target = await isolatedDatabase(null);
  try {
    const result = await restoreBackup({
      pool: target.pool,
      container: source.options.container,
      database: new URL(target.url).pathname.slice(1),
      user: source.options.user,
      directory: source.options.destination,
      mediaDestination: path.join(source.root, "restored-media"),
      policy: source.policy,
      runtimeSha: testSha,
      confirmIsolated: true,
    });
    expect(result.status).toBe("ISOLATED_SYNTHETIC_RESTORE_PASS");
    expect(comparableInventory(await state(target.pool))).toEqual(
      comparableInventory(source.initial),
    );
    const service = catalogImporter(drizzle(target.pool)),
      plan = await service.preview(source.file, "json");
    expect(plan.counts.UNCHANGED).toBe(1);
    await service.apply(source.file, "json", plan.hash);
    expect(comparableInventory(await state(target.pool))).toEqual(
      comparableInventory(source.initial),
    );
    await expect(
      target.pool.query("UPDATE catalog_source_records SET mode='UNSAFE'"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      target.pool.query("UPDATE ingredient_nutrition SET source_kind='UNSAFE'"),
    ).rejects.toMatchObject({ code: "23514" });
    const [nutrition] = await target.db
      .select()
      .from(ingredientNutrition)
      .where(eq(ingredientNutrition.ingredientId, source.ingredientId));
    expect(nutrition).toMatchObject({
      basisQuantity: "0.500000",
      sourceKind: "IMPORT",
      sourceIdentifier: "synthetic:1",
      carbohydratesG: "0.000001",
    });
    const before = await target.pool.query(
      "SELECT revision FROM catalog_revision",
    );
    await target.pool.query("UPDATE ingredients SET name=name WHERE id=$1", [
      source.ingredientId,
    ]);
    expect(
      BigInt(
        (await target.pool.query("SELECT revision FROM catalog_revision"))
          .rows[0].revision,
      ),
    ).toBeGreaterThan(BigInt(before.rows[0].revision));
    const id = await recipeRepository(target.db).saveRecipe({
      title: "After restore",
      slug: "after-restore",
      baseServings: 1,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      status: "PUBLISHED",
      ingredients: [
        {
          ingredientId: source.ingredientId,
          quantity: "1.000001",
          unitId: standardUnitIds.g,
        },
      ],
      steps: ["Synthetic"],
    });
    expect(
      (await recipeRepository(target.db).findAdminRecipe(id))?.ingredients[0]
        .line.ingredientId,
    ).toBe(source.ingredientId);
    console.log(
      "ISOLATED_SYNTHETIC_FULL_RESTORE=PASS; DATA_SCHEMA_MEDIA_IMPORT_TRIGGER_UUID=PASS; REAL_OFFSITE_DRILL=PENDING_OWNER",
    );
  } finally {
    await target.cleanup();
  }
}, 60000);
it("missing objects, disabled triggers, unknown tables and incomplete inventory cannot satisfy approved schema guard", () => {
  const original = source.initial;
  for (const alter of [
    (x: typeof original) => {
      x.schema.functions = [];
    },
    (x: typeof original) => {
      x.schema.triggers[0][2] = "D";
    },
    (x: typeof original) => {
      x.schema.tables.push("unknown");
    },
    (x: typeof original) => {
      delete x.data.ingredients;
    },
    (x: typeof original) => {
      x.schema.indexes = x.schema.indexes.filter((i) => !i[1].includes("trgm"));
    },
  ]) {
    const broken = structuredClone(original);
    alter(broken);
    expect(() => validateInventory(broken)).toThrow();
  }
  const changed = structuredClone(original);
  changed.schema.constraints = [];
  changed.schemaHash = digest(canonical(changed.schema));
  expect(() => checkGuard(source.policy, testSha, changed)).toThrow();
  expect(() => validateSchema(original.schema, "v0.1")).toThrow();
});
it("checksum damage and unsafe/nonempty restore targets fail without changing saved data", async () => {
  const copy = path.join(source.root, "corrupt");
  await cp(source.options.destination, copy, { recursive: true });
  await writeFile(path.join(copy, "recipes.dump"), "synthetic damage");
  await expect(loadBackup(copy, source.policy, testSha)).rejects.toThrow(
    "CHECKSUM",
  );
  await expect(
    restoreBackup({
      pool: source.db.pool,
      container: source.options.container,
      database: source.options.database,
      user: source.options.user,
      directory: source.options.destination,
      mediaDestination: path.join(source.root, "unsafe"),
      policy: source.policy,
      runtimeSha: testSha,
      confirmIsolated: true,
    }),
  ).rejects.toThrow("NOT_EMPTY");
  await expect(
    restoreBackup({
      pool: source.db.pool,
      container: source.options.container,
      database: "recipes",
      user: source.options.user,
      directory: source.options.destination,
      mediaDestination: path.join(source.root, "unsafe"),
      policy: source.policy,
      runtimeSha: testSha,
      confirmIsolated: true,
    }),
  ).rejects.toThrow("ISOLATED_RESTORE");
  expect(await state(source.db.pool)).toEqual(source.initial);
});
it("owner-decrypted payload binds the remote marker without reading an identity or pretending to perform decryption", async () => {
  const copy = path.join(source.root, "owner-payload");
  await cp(source.options.destination, copy, { recursive: true });
  await unlink(path.join(copy, "COMPLETE"));
  const marker = {
    application: "culinote-backup-v1",
    format: 1,
    snapshot: protectedPoint,
    source_sha: testSha,
    local_manifest_sha256: digest(
      await readFile(path.join(copy, "manifest.json")),
    ),
    private_identity_on_server: false,
    objects: Object.fromEntries(
      ["database.encrypted", "media.encrypted", "manifest.encrypted"].map(
        (name) => [
          name,
          {
            key: `culinote/blobs/${protectedPoint}/${name}`,
            bytes: 1,
            sha256: "a".repeat(64),
          },
        ],
      ),
    ),
  };
  await writeFile(
    path.join(copy, "REMOTE-COMPLETE.json"),
    JSON.stringify(marker),
  );
  await expect(loadBackup(copy, source.policy, testSha)).rejects.toThrow();
  await expect(
    loadBackup(copy, source.policy, testSha, "owner-decrypted"),
  ).resolves.toBeTruthy();
  marker.local_manifest_sha256 = "b".repeat(64);
  await writeFile(
    path.join(copy, "REMOTE-COMPLETE.json"),
    JSON.stringify(marker),
  );
  await expect(
    loadBackup(copy, source.policy, testSha, "owner-decrypted"),
  ).rejects.toThrow("BINDING");
});
it("runtime drift at publication rejects capture without publishing COMPLETE or changing a prior point", async () => {
  const destination = path.join(source.root, "runtime-drift");
  await expect(
    captureBackup({
      ...source.options,
      destination,
      assertRuntime: async () => {
        throw new Error("RUNTIME_CHANGED_DURING_CAPTURE");
      },
    }),
  ).rejects.toThrow("RUNTIME_CHANGED_DURING_CAPTURE");
  await expect(readFile(path.join(destination, "COMPLETE"))).rejects.toThrow();
  await expect(
    loadBackup(source.options.destination, source.policy, testSha),
  ).resolves.toBeTruthy();
}, 60000);
it("failed media/checksum capture never publishes COMPLETE or invalidates a prior completed point", async () => {
  const corruptMedia = JSON.parse(
    await readFile(
      path.join(source.options.destination, "media-manifest.json"),
      "utf8",
    ),
  )[0];
  await writeFile(
    path.join(source.mediaRoot, corruptMedia.key),
    "synthetic damage",
  );
  const destination = path.join(source.root, "failed-capture");
  await expect(
    captureBackup({ ...source.options, destination }),
  ).rejects.toThrow("MEDIA");
  await expect(readFile(path.join(destination, "COMPLETE"))).rejects.toThrow();
  await expect(
    loadBackup(source.options.destination, source.policy, testSha),
  ).resolves.toBeTruthy();
}, 60000);
it("exact SHA/schema transition and app rollback keep full v0.2 inventory and protected recovery point", async () => {
  const legacy = await legacyMigrations(),
    db = await isolatedDatabase(legacy.root);
  try {
    const old = await state(db.pool, "v0.1"),
      oldSha = "4f4807aa90c1bb52d6faaec5121f7c27bdada464",
      newState = source.initial;
    const policy: ReleasePolicy = {
      ...source.policy,
      rules: [
        {
          runtimeSha: oldSha,
          schemaHash: old.schemaHash,
          inventoryVersion: "v0.1",
        },
        {
          runtimeSha: oldSha,
          schemaHash: newState.schemaHash,
          inventoryVersion: "v0.2",
        },
        {
          runtimeSha: testSha,
          schemaHash: newState.schemaHash,
          inventoryVersion: "v0.2",
        },
      ],
    };
    expect(checkGuard(policy, oldSha, old).inventoryVersion).toBe("v0.1");
    expect(checkGuard(policy, oldSha, newState).inventoryVersion).toBe("v0.2");
    expect(checkGuard(policy, testSha, newState).inventoryVersion).toBe("v0.2");
    expect(() => checkGuard(policy, testSha, old)).toThrow();
    expect(() => checkGuard(policy, "b".repeat(40), newState)).toThrow();
    expect(() =>
      checkBinding(
        policy,
        {
          source_sha: oldSha,
          inventory_version: "v0.1",
          schema_hash: newState.schemaHash,
          backup_tool_sha: testSha,
        },
        oldSha,
        newState,
      ),
    ).toThrow();
    expect(policy.protectedRecoverySnapshot).toBe(protectedPoint);
    console.log(
      "SHA_SCHEMA_TRANSITION_SIMULATION=PASS; PROTECTED_RECOVERY_POINT_UNCHANGED=PASS",
    );
  } finally {
    await db.cleanup();
    await legacy.cleanup();
  }
});
