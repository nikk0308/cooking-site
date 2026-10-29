import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  rm,
  open,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import brokerContract from "./broker-contract.json";
import type { Pool } from "pg";
import { z } from "zod";
import { checkBinding, checkGuard, type ReleasePolicy } from "./guard";
import {
  canonical,
  digest,
  inventory,
  validateInventory,
  comparableInventory,
} from "./inventory";

const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const mediaRow = z
  .object({
    key: z.string().regex(/^[a-f0-9-]{36}\.webp$/),
    size: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sha256: checksum,
  })
  .strict();
const mediaRows = z.array(mediaRow).max(100000);
const files = [
  "recipes.dump",
  "media.tar.gz",
  "database-state.json",
  "media-manifest.json",
  "restore-list.txt",
] as const;
const checked = [...files, "manifest.json"];
const manifestSchema = z
  .object({
    format: z.literal(1),
    completed_utc: z.iso.datetime(),
    source_sha: z.string().regex(/^[a-f0-9]{40}$/),
    backup_tool_sha: z.string().regex(/^[a-f0-9]{40}$/),
    inventory_version: z.enum(["v0.1", "v0.2"]),
    schema_hash: checksum,
    database: z.string(),
    runtime_image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    postgres_image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    exported_snapshot: z.string(),
    media_records: z.number().int().nonnegative(),
    files: z.record(
      z.string(),
      z
        .object({ sha256: checksum, bytes: z.number().int().nonnegative() })
        .strict(),
    ),
  })
  .strict();
export async function run(
  command: string,
  args: string[],
  options: { inputFile?: string; outputFile?: string } = {},
) {
  const broker = process.env.CULINOTE_BACKUP_DOCKER_BROKER;
  const brokerArgs =
    command === "docker" && broker
      ? [
          fileURLToPath(new URL("./docker_broker.py", import.meta.url)),
          "client",
          "--socket",
          broker,
          "--input-bytes",
          String(options.inputFile ? (await lstat(options.inputFile)).size : 0),
          "--",
          ...args,
        ]
      : null;
  const child = spawn(brokerArgs ? "python3" : command, brokerArgs ?? args, {
    stdio: [options.inputFile ? "pipe" : "ignore", "pipe", "pipe"],
  });
  let output = "",
    errorBytes = 0;
  child.stderr!.on("data", (b: Buffer) => {
    errorBytes += b.length;
  });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("BACKUP_TOOL_UNAVAILABLE")));
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `BACKUP_TOOL_FAILED_${command}_${errorBytes > 0 ? "DETAILS_SUPPRESSED" : "NO_STDERR"}`,
            ),
          ),
    );
  });
  const streams: Promise<unknown>[] = [completed];
  if (options.inputFile)
    streams.push(pipeline(createReadStream(options.inputFile), child.stdin!));
  if (options.outputFile)
    streams.push(
      pipeline(
        child.stdout!,
        createWriteStream(options.outputFile, { flags: "wx", mode: 0o600 }),
      ),
    );
  else
    child.stdout!.on("data", (b: Buffer) => {
      if (output.length + b.length > 4 * 1024 * 1024) {
        child.kill();
        return;
      }
      output += b.toString();
    });
  await Promise.all(streams);
  return output.trim();
}
export async function fileDigest(file: string) {
  const hash = await import("node:crypto").then((c) => c.createHash("sha256"));
  for await (const b of createReadStream(file)) hash.update(b);
  return hash.digest("hex");
}
async function json(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}
async function sync(file: string) {
  const fd = await open(file, (await lstat(file)).isDirectory() ? "r" : "r+");
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}
function targetArgs(container: string, db: string, user: string) {
  for (const value of [container, db, user])
    if (!/^[a-zA-Z0-9_.-]+$/.test(value))
      throw new Error("UNSAFE_DATABASE_TARGET");
  return ["exec", "-i", container];
}
export async function inspectRuntime(container: string) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(container))
    throw new Error("UNSAFE_RUNTIME_TARGET");
  const meta = JSON.parse(
    await run("docker", [
      "inspect",
      "--format",
      brokerContract.runtimeInspect,
      container,
    ]),
  );
  return {
    sha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(meta.sha),
    image: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .parse(meta.image),
  };
}
export type BackupOptions = {
  pool: Pool;
  container: string;
  database: string;
  user: string;
  mediaRoot: string;
  destination: string;
  version: "v0.1" | "v0.2";
  runtime: { sha: string; image: string };
  policy: ReleasePolicy;
  toolSha: string;
};
export async function captureBackup(o: BackupOptions) {
  const dest = path.resolve(o.destination);
  await mkdir(dest, { mode: 0o700 });
  const client = await o.pool.connect(),
    stage = path.join(dest, "media-stage");
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id as string;
    const state = await inventory(client, o.version);
    if (o.toolSha !== o.policy.toolSha)
      throw new Error("BACKUP_TOOL_SHA_NOT_APPROVED");
    checkGuard(o.policy, o.runtime.sha, state);
    const args = targetArgs(o.container, o.database, o.user);
    const system = (
      await client.query(
        "SELECT system_identifier::text id FROM pg_control_system()",
      )
    ).rows[0].id;
    const toolSystem = await run("docker", [
      ...args,
      "psql",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      o.user,
      "-d",
      o.database,
      "-c",
      "SELECT system_identifier::text FROM pg_control_system()",
    ]);
    if (system !== toolSystem)
      throw new Error("DATABASE_CONTAINER_IDENTITY_MISMATCH");
    const rows = mediaRows.parse(
      (
        await client.query(
          "SELECT storage_key AS key,size_bytes AS size,sha256 FROM media ORDER BY storage_key",
        )
      ).rows,
    );
    await json(path.join(dest, "database-state.json"), state);
    await json(path.join(dest, "media-manifest.json"), rows);
    await run(
      "docker",
      [
        ...args,
        "pg_dump",
        "-U",
        o.user,
        "-d",
        o.database,
        "-Fc",
        `--snapshot=${snapshot}`,
      ],
      { outputFile: path.join(dest, "recipes.dump") },
    );
    await mkdir(stage, { mode: 0o700 });
    for (const row of rows) {
      const source = path.join(path.resolve(o.mediaRoot), row.key),
        stat = await lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.size)
        throw new Error("MEDIA_FILE_INVALID");
      const handle = await open(source, "r");
      let bytes: Buffer;
      try {
        const opened = await handle.stat();
        if (opened.ino !== stat.ino || opened.size !== stat.size)
          throw new Error("MEDIA_CHANGED");
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (bytes.length !== row.size || digest(bytes) !== row.sha256)
        throw new Error("MEDIA_CHECKSUM_MISMATCH");
      await writeFile(path.join(stage, row.key), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    }
    await run("tar", [
      "-czf",
      path.join(dest, "media.tar.gz"),
      "-C",
      stage,
      ".",
    ]);
    await chmod(path.join(dest, "media.tar.gz"), 0o600);
    if (path.dirname(stage) !== dest || (await lstat(stage)).isSymbolicLink())
      throw new Error("UNSAFE_STAGING_CLEANUP");
    await rm(stage, { recursive: true });
    await run("docker", [...args, "pg_restore", "--list"], {
      inputFile: path.join(dest, "recipes.dump"),
      outputFile: path.join(dest, "restore-list.txt"),
    });
    await client.query("ROLLBACK");
    const pgImage = await run("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      o.container,
    ]);
    const meta: z.infer<typeof manifestSchema> = {
      format: 1,
      completed_utc: new Date().toISOString(),
      source_sha: o.runtime.sha,
      backup_tool_sha: o.toolSha,
      inventory_version: o.version,
      schema_hash: state.schemaHash,
      database: o.database,
      runtime_image: o.runtime.image,
      postgres_image: pgImage,
      exported_snapshot: snapshot,
      media_records: rows.length,
      files: {},
    };
    for (const name of files)
      meta.files[name] = {
        sha256: await fileDigest(path.join(dest, name)),
        bytes: (await lstat(path.join(dest, name))).size,
      };
    manifestSchema.parse(meta);
    await json(path.join(dest, "manifest.json"), meta);
    await writeFile(
      path.join(dest, "SHA256SUMS"),
      (
        await Promise.all(
          checked.map(
            async (name) =>
              `${await fileDigest(path.join(dest, name))}  ${name}\n`,
          ),
        )
      ).join(""),
      { flag: "wx", mode: 0o600 },
    );
    // Validate every artifact before publishing the same completion marker as v0.1.
    await loadBackup(dest, o.policy, o.runtime.sha, false);
    for (const name of [...checked, "SHA256SUMS"])
      await sync(path.join(dest, name));
    await writeFile(path.join(dest, "COMPLETE"), "CULINOTE_BACKUP_SUCCESS\n", {
      flag: "wx",
      mode: 0o600,
    });
    await sync(path.join(dest, "COMPLETE"));
    if (process.platform !== "win32") await sync(dest);
    return { destination: dest, state, manifest: meta };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function loadBackup(
  directory: string,
  policy: ReleasePolicy,
  runtimeSha: string,
  requireComplete: boolean | "owner-decrypted" = true,
) {
  const root = path.resolve(directory);
  const directoryStat = await lstat(root);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    throw new Error("UNSAFE_BACKUP_DIRECTORY");
  for (const name of [
    ...checked,
    "SHA256SUMS",
    ...(requireComplete === true
      ? ["COMPLETE"]
      : requireComplete === "owner-decrypted"
        ? ["REMOTE-COMPLETE.json"]
        : []),
  ]) {
    const s = await lstat(path.join(root, name));
    if (!s.isFile() || s.isSymbolicLink())
      throw new Error("UNSAFE_BACKUP_ARTIFACT");
    if (
      !name.endsWith(".dump") &&
      !name.endsWith(".gz") &&
      s.size > 64 * 1024 * 1024
    )
      throw new Error("BACKUP_METADATA_TOO_LARGE");
  }
  if (
    requireComplete === true &&
    (await readFile(path.join(root, "COMPLETE"), "utf8")) !==
      "CULINOTE_BACKUP_SUCCESS\n"
  )
    throw new Error("BACKUP_NOT_COMPLETE");
  const sums = (await readFile(path.join(root, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n"),
    seen = new Set<string>();
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})  ([a-zA-Z0-9.-]+)$/);
    if (
      !match ||
      !checked.includes(match[2] as (typeof checked)[number]) ||
      seen.has(match[2]) ||
      (await fileDigest(path.join(root, match[2]))) !== match[1]
    )
      throw new Error("BACKUP_CHECKSUM_MISMATCH");
    seen.add(match[2]);
  }
  if (seen.size !== checked.length)
    throw new Error("BACKUP_CHECKSUM_INVENTORY_INCOMPLETE");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")),
  );
  if (
    canonical(Object.keys(manifest.files).sort()) !==
    canonical([...files].sort())
  )
    throw new Error("BACKUP_FILE_SET_MISMATCH");
  for (const [name, expected] of Object.entries(manifest.files))
    if (
      expected.bytes !== (await lstat(path.join(root, name))).size ||
      expected.sha256 !== (await fileDigest(path.join(root, name)))
    )
      throw new Error("MANIFEST_FILE_MISMATCH");
  const state = validateInventory(
    JSON.parse(await readFile(path.join(root, "database-state.json"), "utf8")),
  );
  checkBinding(policy, manifest, runtimeSha, state);
  if (requireComplete === "owner-decrypted") {
    const remote = z
      .object({
        application: z.literal("culinote-backup-v1"),
        format: z.literal(1),
        snapshot: z
          .string()
          .regex(/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}-[a-f0-9]{12}$/),
        source_sha: z.literal(runtimeSha),
        local_manifest_sha256: checksum,
        private_identity_on_server: z.literal(false),
        objects: z.record(
          z.string(),
          z.object({
            key: z.string(),
            sha256: checksum,
            bytes: z.number().int().positive(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(path.join(root, "REMOTE-COMPLETE.json"), "utf8"),
        ),
      );
    if (
      remote.local_manifest_sha256 !==
        (await fileDigest(path.join(root, "manifest.json"))) ||
      canonical(Object.keys(remote.objects).sort()) !==
        canonical([
          "database.encrypted",
          "manifest.encrypted",
          "media.encrypted",
        ]) ||
      Object.entries(remote.objects).some(
        ([name, value]) =>
          value.key !== `culinote/blobs/${remote.snapshot}/${name}`,
      )
    )
      throw new Error("OWNER_DECRYPTED_REMOTE_BINDING_MISMATCH");
    // The owner performs decryption offline. This validates its resulting payload,
    // never an age identity and never proof that this process decrypted ciphertext.
  }
  const media = mediaRows.parse(
    JSON.parse(await readFile(path.join(root, "media-manifest.json"), "utf8")),
  );
  if (
    new Set(media.map((r) => r.key)).size !== media.length ||
    manifest.media_records !== media.length
  )
    throw new Error("MEDIA_MANIFEST_INVALID");
  return { manifest, state, media };
}
export async function restoreBackup(o: {
  pool: Pool;
  container: string;
  database: string;
  user: string;
  directory: string;
  mediaDestination: string;
  policy: ReleasePolicy;
  runtimeSha: string;
  confirmIsolated: boolean;
  ownerDecrypted?: boolean;
}) {
  if (
    !o.confirmIsolated ||
    !/^(recipes_v01|culinote_restore)_[a-f0-9]{32}$/.test(o.database)
  )
    throw new Error("ISOLATED_RESTORE_TARGET_REQUIRED");
  const backup = await loadBackup(
      o.directory,
      o.policy,
      o.runtimeSha,
      o.ownerDecrypted ? "owner-decrypted" : true,
    ),
    client = await o.pool.connect();
  try {
    if (
      (await client.query("SELECT current_database() name")).rows[0].name !==
      o.database
    )
      throw new Error("RESTORE_TARGET_MISMATCH");
    const system = (
      await client.query(
        "SELECT system_identifier::text id FROM pg_control_system()",
      )
    ).rows[0].id;
    const toolSystem = await run("docker", [
      ...targetArgs(o.container, o.database, o.user),
      "psql",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      o.user,
      "-d",
      o.database,
      "-c",
      "SELECT system_identifier::text FROM pg_control_system()",
    ]);
    if (system !== toolSystem)
      throw new Error("DATABASE_CONTAINER_IDENTITY_MISMATCH");
    if (
      (
        await client.query(
          "SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')",
        )
      ).rows.length
    )
      throw new Error("RESTORE_TARGET_NOT_EMPTY");
    const archive = path.join(path.resolve(o.directory), "media.tar.gz"),
      dest = path.resolve(o.mediaDestination);
    const names = (await run("tar", ["-tzf", archive]))
      .split(/\r?\n/)
      .map((n) => n.replace(/^\.\//, "").replace(/\/$/, ""))
      .filter((n) => n && n !== ".");
    const verbose = await run("tar", ["-tvzf", archive]);
    if (
      verbose.split(/\r?\n/).some((line) => line && !/^[d-]/.test(line)) ||
      canonical([...names].sort()) !==
        canonical(backup.media.map((m) => m.key).sort())
    )
      throw new Error("UNSAFE_MEDIA_ARCHIVE");
    await mkdir(dest, { mode: 0o700 });
    await run("tar", [
      "-xzf",
      archive,
      "-C",
      dest,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    for (const row of backup.media) {
      const stat = await lstat(path.join(dest, row.key));
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size !== row.size ||
        (await fileDigest(path.join(dest, row.key))) !== row.sha256
      )
        throw new Error("RESTORED_MEDIA_INVALID");
    }
    const args = targetArgs(o.container, o.database, o.user);
    await run(
      "docker",
      [
        ...args,
        "pg_restore",
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
        "-U",
        o.user,
        "-d",
        o.database,
      ],
      { inputFile: path.join(o.directory, "recipes.dump") },
    );
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const restored = await inventory(client, backup.state.schemaVersion);
    await client.query("ROLLBACK");
    if (
      canonical(comparableInventory(restored)) !==
      canonical(comparableInventory(backup.state))
    ) {
      const sections = [
        ...Object.keys(restored.schema)
          .filter(
            (k) =>
              canonical(restored.schema[k as keyof typeof restored.schema]) !==
              canonical(backup.state.schema[k as keyof typeof restored.schema]),
          )
          .map((k) => "schema." + k),
        ...Object.keys(restored.data)
          .filter(
            (k) =>
              canonical(restored.data[k]) !== canonical(backup.state.data[k]),
          )
          .map((k) => "data." + k),
      ];
      throw new Error(
        "RESTORED_DATABASE_INVENTORY_MISMATCH:" + sections.join(","),
      );
    }
    return {
      status: "ISOLATED_SYNTHETIC_RESTORE_PASS" as const,
      sourceSha: backup.manifest.source_sha,
      schemaHash: restored.schemaHash,
    };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
