import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";
import { releasePolicy } from "./guard";
import {
  captureBackup,
  inspectRuntime,
  loadBackup,
  restoreBackup,
  run,
} from "./archive";
const { values: v } = parseArgs({
  options: {
    mode: { type: "string" },
    policy: { type: "string" },
    directory: { type: "string" },
    "database-env": { type: "string" },
    "pg-container": { type: "string" },
    "app-container": { type: "string" },
    media: { type: "string" },
    version: { type: "string" },
    "runtime-sha": { type: "string" },
    "tool-sha": { type: "string" },
    "confirm-isolated-restore": { type: "boolean" },
    "owner-decrypted-payload": { type: "boolean" },
  },
});
let pool: Pool | undefined;
try {
  if (process.version !== "v24.20.0") throw new Error("PINNED_NODE_REQUIRED");
  if (!v.policy || !v.directory)
    throw new Error("EXPLICIT_POLICY_AND_DIRECTORY_REQUIRED");
  const policy = releasePolicy.parse(
    JSON.parse(await readFile(v.policy, "utf8")),
  );
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const toolSha = await run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  if (
    await run("git", [
      "-C",
      sourceRoot,
      "status",
      "--porcelain",
      "--untracked-files=normal",
    ])
  )
    throw new Error("BACKUP_TOOL_CHECKOUT_NOT_CLEAN");
  if (
    toolSha !== policy.toolSha ||
    (v["tool-sha"] && v["tool-sha"] !== toolSha)
  )
    throw new Error("BACKUP_TOOL_SOURCE_MISMATCH");
  if (v.mode === "validate") {
    if (!v["runtime-sha"]) throw new Error("EXPLICIT_RUNTIME_SHA_REQUIRED");
    await loadBackup(v.directory, policy, v["runtime-sha"]);
    console.log("VERSIONED_BACKUP_CONTRACT=PASS");
  } else {
    const env = v["database-env"];
    if (
      !env ||
      !/^BACKUP_[A-Z0-9_]+$/.test(env) ||
      !process.env[env] ||
      !v["pg-container"] ||
      !v.media
    )
      throw new Error("EXPLICIT_BACKUP_DATABASE_ENV_AND_TARGET_REQUIRED");
    const url = new URL(process.env[env]!);
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new Error("POSTGRESQL_REQUIRED");
    pool = new Pool({
      connectionString: url.href,
      max: 2,
      connectionTimeoutMillis: 10000,
      query_timeout: 30000,
    });
    if (
      !(
        await pool.query("SHOW server_version")
      ).rows[0].server_version.startsWith("18.")
    )
      throw new Error("POSTGRESQL_18_REQUIRED");
    const database = decodeURIComponent(url.pathname.slice(1)),
      user = decodeURIComponent(url.username);
    if (v.mode === "capture") {
      if (!v["app-container"] || !["v0.1", "v0.2"].includes(v.version ?? ""))
        throw new Error("EXPLICIT_APP_AND_INVENTORY_VERSION_REQUIRED");
      const runtime = await inspectRuntime(v["app-container"]);
      if (!v["runtime-sha"] || runtime.sha !== v["runtime-sha"])
        throw new Error("EXPECTED_RUNTIME_SHA_MISMATCH");
      await captureBackup({
        pool,
        container: v["pg-container"],
        database,
        user,
        mediaRoot: v.media,
        destination: v.directory,
        version: v.version as "v0.1" | "v0.2",
        runtime,
        policy,
        toolSha,
        assertRuntime: async () => {
          const current = await inspectRuntime(v["app-container"]!);
          if (current.sha !== runtime.sha || current.image !== runtime.image)
            throw new Error("RUNTIME_CHANGED_DURING_CAPTURE");
        },
      });
      console.log("VERSIONED_LOCAL_BACKUP_COMPLETE=PASS");
    } else if (v.mode === "restore") {
      if (!v["runtime-sha"]) throw new Error("EXPLICIT_RUNTIME_SHA_REQUIRED");
      await restoreBackup({
        pool,
        container: v["pg-container"],
        database,
        user,
        directory: v.directory,
        mediaDestination: v.media,
        policy,
        runtimeSha: v["runtime-sha"],
        confirmIsolated: !!v["confirm-isolated-restore"],
        ownerDecrypted: !!v["owner-decrypted-payload"],
      });
      console.log("ISOLATED_DATABASE_AND_MEDIA_RESTORE=PASS");
    } else throw new Error("MODE_MUST_BE_CAPTURE_VALIDATE_OR_RESTORE");
  }
} catch {
  console.error(
    "VERSIONED_BACKUP_OPERATION=FAIL; no credentials or database contents logged; verify the explicit target, policy, complete inventory and protected local files.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
