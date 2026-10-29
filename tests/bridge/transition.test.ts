import { it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  chmod,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { isolatedDatabase } from "../helpers/database";
import { legacyMigrations } from "../helpers/legacy-migrations";
import { state } from "../recovery/fixture";
import { run, fileDigest, loadBackup } from "../../scripts/backup/archive";
import { releasePolicy, checkGuard } from "../../scripts/backup/guard";
import inputs from "../../scripts/backup/build-inputs.json";
import { catalogImporter } from "../../src/modules/catalog/importer";

const oldSha = inputs.inspectedV01GuardSha;
const newSha = "12fb36f58e6bb759394337487fabb601b3fdce9c"; // Candidate APP source, not TOOL identity.
async function json(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
}
async function child(
  command: string,
  args: string[],
  env = process.env,
  cwd = process.cwd(),
) {
  const p = spawn(command, args, {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  p.stdout.on("data", (b) => {
    output += b;
  });
  // Child interfaces deliberately suppress credentials/data in failure messages.
  const safeErrorCodes: string[] = [];
  p.stderr.on("data", (b) => {
    for (const match of String(b).matchAll(
      /(?:CULINOTE_BACKUP_FAILURE|BACKUP_DOCKER_BROKER=FAIL) code=([A-Z_]{3,80})/g,
    ))
      if (safeErrorCodes.length < 10) safeErrorCodes.push(match[1]);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    p.on("error", reject);
    p.on("exit", resolve);
  });
  return { code, output, safeErrorCodes };
}
function waitReady(p: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("FIXTURE_READY_TIMEOUT")),
      10000,
    );
    p.stdout!.on("data", (b) => {
      if (String(b).includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    p.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("FIXTURE_EXIT_BEFORE_READY"));
    });
  });
}

it("host bridge rehearses legacy, bridge, migration, new runtime and application-only rollback with real private captures", async () => {
  if (
    !process.env.BRIDGE_ENVIRONMENT_DIR ||
    !process.env.BACKUP_TEST_PG_CONTAINER ||
    process.platform !== "linux" ||
    process.getuid!() === 0
  )
    throw new Error("EXPLICIT_NONROOT_LINUX_BRIDGE_FIXTURE_REQUIRED");
  const root = await mkdtemp(path.join(os.tmpdir(), "culinote-bridge-"));
  const legacy = await legacyMigrations();
  const old = await isolatedDatabase(legacy.root),
    next = await isolatedDatabase();
  const source = path.join(root, "source"),
    environment = process.env.BRIDGE_ENVIRONMENT_DIR;
  const token = randomUUID().slice(0, 8),
    app = "culinote-bridge-app-" + token,
    project = "culinote-bridge-ci";
  const reader = "bridge_reader_" + token.replaceAll("-", "");
  let broker: ChildProcess | undefined;
  const brokerSocket = path.join(root, "broker.sock"),
    configFile = path.join(root, "bridge.json");
  const backupLock = path.join(root, "backup.lock"),
    uploadLock = path.join(root, "upload.lock");
  const pgContainer = process.env.BACKUP_TEST_PG_CONTAINER;
  const node = path.join(environment, "node");
  const entry = path.resolve("scripts/backup/bridge.py");
  const brokerEntry = path.resolve("scripts/backup/docker_broker.py");
  let appExists = false;
  const removeApp = async () => {
    if (appExists) {
      expect(
        await run("docker", [
          "inspect",
          "--format",
          '{{index .Config.Labels "com.culinote.fixture"}}',
          app,
        ]),
      ).toBe(token);
      await run("docker", ["rm", "--force", app]);
      appExists = false;
    }
  };
  const runtime = async (sha: string) => {
    await removeApp();
    await run("docker", [
      "run",
      "--detach",
      "--name",
      app,
      "--label",
      `com.culinote.fixture=${token}`,
      "--label",
      `com.docker.compose.project=${project}`,
      "--label",
      "com.docker.compose.service=app",
      "--label",
      `org.opencontainers.image.revision=${sha}`,
      "--user",
      "10001:10001",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      inputs.nodeImage,
      "tail",
      "-f",
      "/dev/null",
    ]);
    appExists = true;
  };
  try {
    expect(
      (await old.pool.query("SHOW server_version")).rows[0].server_version,
    ).toMatch(/^18\.6(?:\s|$)/);
    console.log("BRIDGE_POSTGRES=18.6; SYNTHETIC_ONLY");
    await run("git", ["clone", "--no-hardlinks", process.cwd(), source]);
    const toolSha = await run("git", ["rev-parse", "HEAD"]);
    await run("git", ["-C", source, "checkout", "--detach", toolSha]);
    await chmod(source, 0o700);
    await symlink(
      path.join(environment, "node_modules"),
      path.join(source, "node_modules"),
    );
    expect(await run("git", ["-C", source, "status", "--porcelain"])).toBe("");
    expect(await run(node, ["--version"])).toBe("v24.20.0");
    await mkdir(path.join(root, "daily"), { mode: 0o700 });
    await mkdir(path.join(root, "media"), { mode: 0o700 });
    await writeFile(backupLock, "", { mode: 0o600 });
    await writeFile(uploadLock, "", { mode: 0o600 });
    const ingredientId = randomUUID();
    await old.pool.query(
      "INSERT INTO ingredients(id,name,slug) VALUES($1,'Synthetic legacy ingredient','synthetic-legacy')",
      [ingredientId],
    );
    const recipeId = randomUUID();
    await old.pool.query(
      "INSERT INTO recipes(id,title,slug,base_servings,status) VALUES($1,'Synthetic legacy recipe','bridge-legacy-recipe',4,'DRAFT')",
      [recipeId],
    );
    await old.pool.query(
      "INSERT INTO recipe_ingredients(recipe_id,ingredient_id,quantity,unit_id,position) VALUES($1,$2,'0.123456','10000000-0000-4000-8000-000000000001',1)",
      [recipeId, ingredientId],
    );
    await old.pool.query(
      "INSERT INTO recipe_steps(recipe_id,position,instruction) VALUES($1,1,'Synthetic legacy step')",
      [recipeId],
    );
    await old.pool.query(
      "INSERT INTO ingredient_nutrition(ingredient_id,basis_quantity,basis_unit_id,calories_kcal,protein_g,fat_g,carbohydrates_g,source_note) VALUES($1,'100','10000000-0000-4000-8000-000000000001','1','0','0','0','Synthetic legacy test only')",
      [ingredientId],
    );
    const initial = await state(old.pool, "v0.1"),
      reference = await state(next.pool);
    expect((await state(old.pool, "v0.1")).schemaHash).toBe(initial.schemaHash);
    expect((await state(next.pool)).schemaHash).toBe(reference.schemaHash);
    expect(initial.schema.tables).toHaveLength(9);
    expect(reference.schema.tables).toHaveLength(14);
    const v01 = path.join(root, "reference-v01.json"),
      v02 = path.join(root, "reference-v02.json"),
      policyFile = path.join(root, "policy.json");
    await json(v01, initial);
    await json(v02, reference);
    const generated = await child(
      node,
      [
        path.join(source, "node_modules/tsx/dist/cli.mjs"),
        "scripts/backup/prepare.ts",
        "--mode",
        "policy",
        "--v01",
        v01,
        "--v02",
        v02,
        "--old-sha",
        oldSha,
        "--new-sha",
        newSha,
        "--output",
        policyFile,
      ],
      { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      source,
    );
    expect(generated.code).toBe(0);
    const policy = releasePolicy.parse(
      JSON.parse(await readFile(policyFile, "utf8")),
    );
    expect(policy.toolSha).toBe(toolSha);
    expect(toolSha).not.toBe(newSha);
    expect(checkGuard(policy, oldSha, initial).inventoryVersion).toBe("v0.1");
    expect(checkGuard(policy, oldSha, reference).inventoryVersion).toBe("v0.2");
    expect(checkGuard(policy, newSha, reference).inventoryVersion).toBe("v0.2");
    expect(() => checkGuard(policy, newSha, initial)).toThrow();
    expect(() => checkGuard(policy, "b".repeat(40), reference)).toThrow();
    expect(() =>
      releasePolicy.parse({
        ...policy,
        protectedRecoverySnapshot: "20260101T000000Z-00000000-000000000000",
      }),
    ).toThrow();
    const repeatFile = path.join(root, "policy-repeat.json");
    expect(
      (
        await child(
          node,
          [
            path.join(source, "node_modules/tsx/dist/cli.mjs"),
            "scripts/backup/prepare.ts",
            "--mode",
            "policy",
            "--v01",
            v01,
            "--v02",
            v02,
            "--old-sha",
            oldSha,
            "--new-sha",
            newSha,
            "--output",
            repeatFile,
          ],
          { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
          source,
        )
      ).code,
    ).toBe(0);
    expect(await readFile(repeatFile, "utf8")).toBe(
      await readFile(policyFile, "utf8"),
    );
    console.log(
      `REFERENCE_POLICY_DETERMINISTIC=PASS v01=${initial.schemaHash} v02=${reference.schemaHash}`,
    );
    await old.pool.query(
      `CREATE ROLE ${reader} LOGIN PASSWORD 'synthetic-bridge-only'`,
    );
    const grantReader = async () => {
      await old.pool.query(
        `GRANT USAGE ON SCHEMA public,drizzle TO ${reader}; GRANT SELECT ON ALL TABLES IN SCHEMA public,drizzle TO ${reader}; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public,drizzle TO ${reader}; GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ${reader}`,
      );
    };
    await grantReader();
    const url = new URL(old.url);
    url.username = reader;
    url.password = "synthetic-bridge-only";
    const credential = path.join(root, "database-credential");
    await writeFile(credential, url.href, { mode: 0o600 });
    await runtime(oldSha);
    const pgImage = await run("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      pgContainer,
    ]);
    const runtimeImage = await run("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      app,
    ]);
    const brokerConfig = path.join(root, "broker.json");
    await json(brokerConfig, {
      format: 1,
      runner_uid: process.getuid!(),
      socket: brokerSocket,
      docker: await run("which", ["docker"]),
      docker_socket: "/var/run/docker.sock",
      project,
      app_container: app,
      pg_container: pgContainer,
      pg_image: pgImage,
      pg_uid: 70,
      database: url.pathname.slice(1),
      database_user: reader,
      runtimes: [
        { sha: oldSha, image: runtimeImage },
        { sha: newSha, image: runtimeImage },
      ],
    });
    broker = spawn(
      "python3",
      [
        "-B",
        brokerEntry,
        "serve",
        "--config",
        brokerConfig,
        "--allow-docker-authority",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    broker.stderr!.on("data", (b) => {
      for (const match of String(b).matchAll(
        /BACKUP_BROKER_REQUEST_FAILED code=([A-Z_]{3,80})/g,
      ))
        console.log("BROKER_FIXTURE_CODE=" + match[1]);
    });
    await waitReady(broker);
    const config = {
      format: 1,
      source,
      environment,
      environment_manifest_sha256: await fileDigest(
        path.join(environment, "environment.json"),
      ),
      policy: policyFile,
      tool_sha: toolSha,
      runtime_sha: oldSha,
      inventory_version: "v0.1",
      database: url.pathname.slice(1),
      database_user: reader,
      database_credential: credential,
      app_container: app,
      pg_container: pgContainer,
      media: path.join(root, "media"),
      destination_root: path.join(root, "daily"),
      backup_lock: backupLock,
      broker_socket: brokerSocket,
      broker_uid: process.getuid!(),
      minimum_free_bytes: 10 * 1024 ** 3,
    };
    const capture = async (id: string) => {
      await json(configFile, config);
      const r = await child("python3", [
        "-B",
        entry,
        "--config",
        configFile,
        "--mode",
        "capture",
        "--directory",
        id,
      ]);
      expect(r.code, r.safeErrorCodes.join(",")).toBe(0);
      expect(r.output).toContain("CULINOTE_BACKUP_SUCCESS");
      const dest = path.join(root, "daily", id);
      const loaded = await loadBackup(dest, policy, config.runtime_sha);
      expect(loaded.manifest.backup_tool_sha).toBe(toolSha);
      for (const name of await readdir(dest)) {
        const { stat } = await import("node:fs/promises");
        expect((await stat(path.join(dest, name))).mode & 0o077).toBe(0);
      }
      expect(
        (
          await child("python3", [
            "-B",
            entry,
            "--config",
            configFile,
            "--mode",
            "validate",
            "--directory",
            dest,
          ])
        ).code,
      ).toBe(0);
      return loaded;
    };
    const first = await capture("20260101T000000Z-00000001");
    expect(first.state.schema.tables).toHaveLength(9);
    console.log("BRIDGE_OLD_OLD_CAPTURE_VALIDATE=PASS");
    // Real lock barrier stays held across migration AND the fixture's inventory switch.
    const barrier = spawn(
      "python3",
      [
        "-B",
        "-c",
        "import sys;sys.path.insert(0,sys.argv[1]);from bridge import locked\nwith locked(sys.argv[2:]):\n print('READY',flush=True);input()",
        path.resolve("scripts/backup"),
        backupLock,
        uploadLock,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    barrier.stderr!.resume();
    await waitReady(barrier);
    try {
      expect(
        (
          await child("python3", [
            "-B",
            entry,
            "--config",
            configFile,
            "--mode",
            "capture",
            "--directory",
            "20260101T000000Z-00000002",
          ])
        ).code,
      ).toBe(75);
      await migrate(drizzle(old.pool), { migrationsFolder: "db/migrations" });
      config.inventory_version = "v0.2";
      await json(configFile, config);
      await grantReader();
    } finally {
      barrier.stdin!.end("release\n");
      await new Promise((r) => barrier.once("exit", r));
    }
    expect((await state(old.pool)).schemaHash).toBe(reference.schemaHash);
    expect(
      (
        await old.pool.query("SELECT id FROM ingredients WHERE id=$1", [
          ingredientId,
        ])
      ).rows[0].id,
    ).toBe(ingredientId);
    const imported = catalogImporter(drizzle(old.pool));
    const file = new TextEncoder().encode(
      JSON.stringify({
        application: "culinote-catalog",
        schemaVersion: 1,
        namespace: "bridge-synthetic",
        records: [
          {
            externalId: "one",
            name: "Synthetic bridge product",
            slug: "bridge-product",
            aliases: ["Synthetic alias"],
            category: {
              name: "Synthetic bridge category",
              slug: "bridge-category",
            },
            nutrition: {
              basisQuantity: "100",
              basisUnit: "g",
              caloriesKcal: "1",
              proteinG: "0",
              fatG: "0",
              carbohydratesG: "0",
              sourceKind: "IMPORT",
              sourceNote: "Synthetic test, not reference nutrition",
              sourceIdentifier: "bridge:one",
            },
          },
        ],
      }),
    );
    const plan = await imported.preview(file, "json");
    await imported.apply(file, "json", plan.hash);
    const oldNew = await capture("20260101T000000Z-00000003");
    expect(oldNew.state.schema.tables).toHaveLength(14);
    console.log("BRIDGE_MIGRATION_AND_OLD_NEW_CAPTURE=PASS");
    config.runtime_sha = newSha;
    await runtime(newSha);
    const newNew = await capture("20260101T000000Z-00000004");
    expect(newNew.manifest.source_sha).toBe(newSha);
    console.log("BRIDGE_NEW_NEW_CAPTURE_VALIDATE=PASS");
    await runtime(oldSha);
    config.runtime_sha = oldSha;
    const rollback = await capture("20260101T000000Z-00000005");
    expect(rollback.state.data).toEqual(newNew.state.data);
    expect(rollback.manifest.inventory_version).toBe("v0.2");
    expect((await imported.preview(file, "json")).counts.UNCHANGED).toBe(1);
    expect(
      (
        await old.pool.query(
          "SELECT ingredient_id,quantity::text FROM recipe_ingredients WHERE recipe_id=$1",
          [recipeId],
        )
      ).rows[0],
    ).toEqual({ ingredient_id: ingredientId, quantity: "0.123456" });
    config.inventory_version = "v0.1";
    await json(configFile, config);
    expect(
      (
        await child("python3", [
          "-B",
          entry,
          "--config",
          configFile,
          "--mode",
          "capture",
          "--directory",
          "20260101T000000Z-00000006",
        ])
      ).code,
    ).not.toBe(0);
    await expect(
      readFile(path.join(root, "daily/20260101T000000Z-00000006/COMPLETE")),
    ).rejects.toThrow();
    config.inventory_version = "v0.2";
    for (const altered of [
      { ...config, tool_sha: "c".repeat(40) },
      { ...config, runtime_sha: newSha },
      { ...config, policy: path.join(root, "missing-policy") },
      { ...config, database: "wrong_database" },
      { ...config, environment_manifest_sha256: "d".repeat(64) },
      { ...config, broker_uid: process.getuid!() + 1 },
    ]) {
      await json(configFile, altered);
      expect(
        (
          await child("python3", [
            "-B",
            entry,
            "--config",
            configFile,
            "--mode",
            "capture",
            "--directory",
            "20260101T000000Z-00000007",
          ])
        ).code,
      ).not.toBe(0);
    }
    await writeFile(path.join(source, "README.md"), "synthetic dirty source");
    await json(configFile, config);
    expect(
      (
        await child("python3", [
          "-B",
          entry,
          "--config",
          configFile,
          "--mode",
          "capture",
          "--directory",
          "20260101T000000Z-00000007",
        ])
      ).code,
    ).not.toBe(0);
    expect(await readdir(path.join(root, "daily"))).not.toContain(
      "20260101T000000Z-00000007",
    );
    console.log(
      "BRIDGE_ROLLBACK_FULL_INVENTORY_AND_NEGATIVE_GATES=PASS; PRODUCTION_WIRING_UNVERIFIED",
    );
  } finally {
    broker?.kill("SIGTERM");
    if (broker && broker.exitCode === null)
      await new Promise((r) => broker!.once("exit", r));
    await removeApp();
    await old.cleanup();
    await next.cleanup();
    // Role has no cluster-wide grants. Dropping its isolated DB removes grants.
    const { Pool } = await import("pg");
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.query(`DROP ROLE IF EXISTS ${reader}`);
    } finally {
      await admin.end();
    }
    await legacy.cleanup();
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("culinote-bridge-")
    )
      throw new Error("UNSAFE_FIXTURE_CLEANUP");
    await rm(root, { recursive: true, force: true });
  }
}, 300000);
