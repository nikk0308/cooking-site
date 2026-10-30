import { it, expect } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { historicalMigrations } from "../helpers/historical-migrations";
import { isolatedDatabase } from "../helpers/database";
import { state, testSha, protectedPoint } from "./fixture";
import { captureBackup, restoreBackup } from "../../scripts/backup/archive";
import { comparableInventory } from "../../scripts/backup/inventory";
import type { ReleasePolicy } from "../../scripts/backup/guard";
it("full synthetic restore retains mixed CRLF/LF migration history, data and schema objects", async () => {
  const container = process.env.BACKUP_TEST_PG_CONTAINER;
  if (!container) throw new Error("EXPLICIT_ISOLATED_CONTAINER_REQUIRED");
  const history = await historicalMigrations(2),
    next = await historicalMigrations();
  const db = await isolatedDatabase(history.root),
    target = await isolatedDatabase(null);
  const root = await mkdtemp(
    path.join(os.tmpdir(), "culinote-historical-recovery-"),
  );
  try {
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO ingredients(id,name,slug) VALUES($1,'Synthetic restored history','synthetic-restored-history')",
      [id],
    );
    await migrate(drizzle(db.pool), { migrationsFolder: next.root });
    const before = await state(db.pool);
    const media = path.join(root, "media");
    await mkdir(media, { mode: 0o700 });
    const policy: ReleasePolicy = {
      format: 1,
      toolSha: testSha,
      protectedRecoverySnapshot: protectedPoint,
      rules: [
        {
          runtimeSha: testSha,
          schemaHash: before.schemaHash,
          inventoryVersion: "v0.2",
        },
      ],
    };
    const url = new URL(db.url),
      destination = path.join(root, "snapshot");
    await captureBackup({
      pool: db.pool,
      container,
      database: url.pathname.slice(1),
      user: url.username,
      mediaRoot: media,
      destination,
      version: "v0.2",
      runtime: { sha: testSha, image: "sha256:" + "a".repeat(64) },
      policy,
      toolSha: testSha,
    });
    await restoreBackup({
      pool: target.pool,
      container,
      database: new URL(target.url).pathname.slice(1),
      user: url.username,
      directory: destination,
      mediaDestination: path.join(root, "restored-media"),
      policy,
      runtimeSha: testSha,
      confirmIsolated: true,
    });
    const restored = await state(target.pool);
    expect(comparableInventory(restored)).toEqual(comparableInventory(before));
    expect(restored.schema.migrations.map((m) => m[1])).toEqual(next.hashes);
    expect(
      (await target.pool.query("SELECT id FROM ingredients WHERE id=$1", [id]))
        .rows[0].id,
    ).toBe(id);
    console.log(
      "SYNTHETIC_HISTORICAL_LEDGER_FULL_RESTORE=PASS; NO_REAL_OFFSITE_PROOF",
    );
  } finally {
    await db.cleanup();
    await target.cleanup();
    await history.cleanup();
    await next.cleanup();
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("culinote-historical-recovery-")
    )
      throw new Error("UNSAFE_TEST_CLEANUP");
    await rm(root, { recursive: true });
  }
}, 60000);
