import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootArgument = process.argv.indexOf("--root");
const sourceRoot = path.resolve(
  rootArgument >= 0 ? process.argv[rootArgument + 1] : process.cwd(),
);
const dependencyRoot = path.resolve(process.cwd(), "node_modules");
const temporaryRoot = mkdtempSync(
  path.join(os.tmpdir(), "recipes-migration-drift-"),
);

function fileHashes(root) {
  const hashes = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else
        hashes.set(
          path.relative(root, absolute).replaceAll("\\", "/"),
          createHash("sha256").update(readFileSync(absolute)).digest("hex"),
        );
    }
  }
  visit(root);
  return hashes;
}

try {
  cpSync(
    path.join(sourceRoot, "db", "schema"),
    path.join(temporaryRoot, "db", "schema"),
    { recursive: true },
  );
  cpSync(
    path.join(sourceRoot, "db", "migrations"),
    path.join(temporaryRoot, "db", "migrations"),
    { recursive: true },
  );
  cpSync(
    path.join(sourceRoot, "drizzle.config.ts"),
    path.join(temporaryRoot, "drizzle.config.ts"),
  );
  cpSync(
    path.join(sourceRoot, "package.json"),
    path.join(temporaryRoot, "package.json"),
  );
  symlinkSync(
    dependencyRoot,
    path.join(temporaryRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const migrations = path.join(temporaryRoot, "db", "migrations");
  const before = fileHashes(migrations);
  const drizzleKit = path.join(dependencyRoot, "drizzle-kit", "bin.cjs");
  const result = spawnSync(
    process.execPath,
    [drizzleKit, "generate", "--config", "drizzle.config.ts"],
    {
      cwd: temporaryRoot,
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://validation:validation@127.0.0.1:1/validation",
      },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    const after = fileHashes(migrations);
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (name) => before.get(name) !== after.get(name),
    );
    if (changed.length > 0) {
      console.error(`Schema/migration drift detected: ${changed.join(", ")}`);
      process.exitCode = 1;
    } else console.log("Schema and generated migration metadata are in sync.");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
