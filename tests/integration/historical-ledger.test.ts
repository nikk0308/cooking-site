import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { historicalMigrations } from "../helpers/historical-migrations";
import { isolatedDatabase } from "../helpers/database";
import { state } from "../recovery/fixture";
import { checkGuard, type ReleasePolicy } from "../../scripts/backup/guard";
import inputs from "../../scripts/backup/build-inputs.json";
import { inventory } from "../../scripts/backup/inventory";
it("preserves legitimate CRLF history through LF upgrades and rejects mismatched exact ledger fingerprints", async () => {
  const history = await historicalMigrations(2),
    next = await historicalMigrations(),
    lf = await historicalMigrations(2, false);
  const db = await isolatedDatabase(history.root),
    clean = await isolatedDatabase(lf.root);
  try {
    expect(
      (await db.pool.query("SHOW server_version")).rows[0].server_version,
    ).toMatch(/^18\.6\b/);
    const old = await state(db.pool, "v0.1"),
      alternate = await state(clean.pool, "v0.1");
    expect(old.schema.migrations.map((m) => m[1])).toEqual(history.hashes);
    expect(alternate.schema.migrations.map((m) => m[1])).toEqual(lf.hashes);
    expect(old.schemaHash).not.toBe(alternate.schemaHash);
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO ingredients(id,name,slug) VALUES($1,'Synthetic history ingredient','synthetic-history')",
      [id],
    );
    await migrate(drizzle(db.pool), { migrationsFolder: next.root });
    const upgraded = await state(db.pool);
    expect(upgraded.schema.migrations.slice(0, 2)).toEqual(
      old.schema.migrations,
    );
    expect(upgraded.schema.migrations.map((m) => m[1])).toEqual(next.hashes);
    expect(
      (await db.pool.query("SELECT id FROM ingredients WHERE id=$1", [id]))
        .rows[0].id,
    ).toBe(id);
    await migrate(drizzle(db.pool), { migrationsFolder: next.root });
    expect(await state(db.pool)).toEqual(upgraded);
    const oldSha = "a".repeat(40),
      newSha = "b".repeat(40);
    const policy: ReleasePolicy = {
      format: 1,
      toolSha: "c".repeat(40),
      protectedRecoverySnapshot: inputs.protectedRecoverySnapshot,
      rules: [
        {
          runtimeSha: oldSha,
          inventoryVersion: "v0.1",
          schemaHash: old.schemaHash,
        },
        {
          runtimeSha: oldSha,
          inventoryVersion: "v0.2",
          schemaHash: upgraded.schemaHash,
        },
        {
          runtimeSha: newSha,
          inventoryVersion: "v0.2",
          schemaHash: upgraded.schemaHash,
        },
      ],
    };
    expect(checkGuard(policy, oldSha, old).inventoryVersion).toBe("v0.1");
    expect(checkGuard(policy, oldSha, upgraded).inventoryVersion).toBe("v0.2");
    expect(checkGuard(policy, newSha, upgraded).inventoryVersion).toBe("v0.2");
    expect(() => checkGuard(policy, newSha, old)).toThrow();
    expect(() => checkGuard(policy, oldSha, alternate)).toThrow();
    const c = await db.pool.connect();
    try {
      // Deliberate corruption exists ONLY inside this disposable transaction.
      await c.query("BEGIN");
      await c.query(
        "UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=1",
        ["d".repeat(64)],
      );
      const corrupt = await inventory(c, "v0.2");
      expect(() => checkGuard(policy, newSha, corrupt)).toThrow();
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
    expect(await state(db.pool)).toEqual(upgraded);
  } finally {
    await db.cleanup();
    await clean.cleanup();
    await history.cleanup();
    await next.cleanup();
    await lf.cleanup();
  }
}, 30000);
