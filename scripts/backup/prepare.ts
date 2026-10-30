import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { inventory, validateInventory } from "./inventory";
import { releasePolicy } from "./guard";
import { run } from "./archive";
import inputs from "./build-inputs.json";
const { values: v } = parseArgs({
  options: Object.fromEntries(
    [
      "mode",
      "output",
      "database-env",
      "version",
      "v01",
      "v02",
      "old-sha",
      "new-sha",
    ].map((name) => [name, { type: "string" as const }]),
  ),
});
let pool: Pool | undefined;
try {
  if (process.version !== "v24.20.0") throw new Error("PINNED_NODE_REQUIRED");
  if (!v.output) throw new Error("EXPLICIT_OUTPUT_REQUIRED");
  let result: unknown;
  if (v.mode === "inventory") {
    const env = v["database-env"];
    if (
      !env ||
      !/^BACKUP_[A-Z0-9_]+$/.test(env) ||
      !process.env[env] ||
      !["v0.1", "v0.2"].includes(v.version ?? "")
    )
      throw new Error("EXPLICIT_DATABASE_ENV_AND_VERSION_REQUIRED");
    pool = new Pool({
      connectionString: process.env[env],
      max: 1,
      query_timeout: 30000,
    });
    const client = await pool.connect();
    try {
      if (
        !(
          await client.query("SHOW server_version")
        ).rows[0].server_version.startsWith("18.")
      )
        throw new Error("POSTGRESQL_18_REQUIRED");
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL TIME ZONE 'UTC'");
      result = await inventory(client, v.version as "v0.1" | "v0.2");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  } else if (v.mode === "policy") {
    if (await run("git", ["status", "--porcelain", "--untracked-files=normal"]))
      throw new Error("POLICY_TOOL_CHECKOUT_NOT_CLEAN");
    if (!v.v01 || !v.v02) throw new Error("TWO_REFERENCE_INVENTORIES_REQUIRED");
    const old = validateInventory(JSON.parse(await readFile(v.v01, "utf8"))),
      next = validateInventory(JSON.parse(await readFile(v.v02, "utf8")));
    if (
      old.schemaVersion !== "v0.1" ||
      next.schemaVersion !== "v0.2" ||
      v["old-sha"] === v["new-sha"]
    )
      throw new Error("DISTINCT_REVIEWED_RUNTIME_VERSIONS_REQUIRED");
    result = releasePolicy.parse({
      format: 1,
      toolSha: await run("git", ["rev-parse", "HEAD"]),
      protectedRecoverySnapshot: inputs.protectedRecoverySnapshot,
      rules: [
        {
          runtimeSha: v["old-sha"],
          schemaHash: old.schemaHash,
          inventoryVersion: "v0.1",
        },
        {
          runtimeSha: v["old-sha"],
          schemaHash: next.schemaHash,
          inventoryVersion: "v0.2",
        },
        {
          runtimeSha: v["new-sha"],
          schemaHash: next.schemaHash,
          inventoryVersion: "v0.2",
        },
      ],
    });
  } else throw new Error("MODE_MUST_BE_INVENTORY_OR_POLICY");
  await writeFile(v.output, JSON.stringify(result, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "REVIEW_ARTIFACT_CREATED; no deployment or guard activation performed",
  );
} catch {
  console.error(
    "PREPARE=FAIL; verify explicit inputs; no credentials or rows logged",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
