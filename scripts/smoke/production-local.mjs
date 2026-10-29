import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
const root = mkdtempSync(path.join(os.tmpdir(), "culinote-readiness-smoke-"));
const appImage = process.env.SMOKE_APP_IMAGE ?? "recipes:readiness";
const maintenanceImage =
  process.env.SMOKE_MAINTENANCE_IMAGE ?? "recipes:readiness-maintenance";
const inputs = JSON.parse(
  readFileSync(new URL("../backup/build-inputs.json", import.meta.url), "utf8"),
);
const project = "culinote-smoke-" + randomBytes(4).toString("hex");
const password = randomBytes(20).toString("hex");
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  RECIPES_APP_IMAGE: appImage,
  POSTGRES_IMAGE: inputs.postgresImage,
  DATABASE_URL: "postgresql://recipes:" + password + "@postgres:5432/recipes",
  POSTGRES_PASSWORD: password,
  RECIPES_POSTGRES_DATA_DIR: path.join(root, "postgres"),
  RECIPES_MEDIA_DIR: path.join(root, "media"),
};
for (const name of ["postgres", "media"]) mkdirSync(path.join(root, name));
const run = (args, quiet = false) => {
  const r = spawnSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
  if (r.status !== 0) throw new Error("Docker validation command failed");
  return r.stdout?.trim();
};
try {
  run([
    "run",
    "--rm",
    "--user",
    "0",
    "--mount",
    "type=bind,source=" + env.RECIPES_MEDIA_DIR + ",target=/media",
    "--entrypoint",
    "chown",
    appImage,
    "10001:10001",
    "/media",
  ]);
  run(["compose", "-f", "compose.production.yaml", "up", "-d", "--wait"]);
  const maintenance = (command) =>
    run([
      "run",
      "--rm",
      "--network",
      project + "_database",
      "-e",
      "DATABASE_URL=" + env.DATABASE_URL,
      "-e",
      "MEDIA_ROOT=/app/media",
      "--mount",
      "type=bind,source=" + env.RECIPES_MEDIA_DIR + ",target=/app/media",
      "--user",
      "10001:10001",
      maintenanceImage,
      ...command,
    ]);
  maintenance(["npm", "run", "db:migrate"]);
  maintenance(["npm", "run", "db:seed-demo"]);
  maintenance(["node_modules/.bin/tsx", "scripts/smoke/seed-media.ts"]);
  const smoke = spawnSync(
    process.execPath,
    ["scripts/smoke/production-container.mjs"],
    { env, stdio: "inherit" },
  );
  if (smoke.status !== 0) throw new Error("Runtime smoke failed");
  const logs = run(
    ["compose", "-f", "compose.production.yaml", "logs", "app"],
    true,
  );
  if (
    /EROFS|permission denied|unhandled rejection/i.test(logs) ||
    logs.includes(password)
  )
    throw new Error("Unexpected app logs");
  console.log("PRODUCTION_LIKE_SMOKE=PASS");
} finally {
  const cleanup = spawnSync(
    "docker",
    ["compose", "-f", "compose.production.yaml", "down", "--remove-orphans"],
    { env, stdio: "inherit" },
  );
  if (cleanup.status !== 0) throw new Error("Compose cleanup failed");
  const owned = realpathSync(root);
  if (
    path.dirname(owned) !== realpathSync(os.tmpdir()) ||
    !path.basename(owned).startsWith("culinote-readiness-smoke-")
  )
    throw new Error("Unsafe cleanup path");
  // PostgreSQL owns its directory on Linux. Remove only this task-created mount contents.
  run([
    "run",
    "--rm",
    "--user",
    "0",
    "--mount",
    "type=bind,source=" + root + ",target=/cleanup",
    "--entrypoint",
    "node",
    appImage,
    "-e",
    "const fs=require('fs');for(const p of ['/cleanup/postgres','/cleanup/media'])fs.rmSync(p,{recursive:true,force:true})",
  ]);
  const resolved = realpathSync(root),
    parent = realpathSync(os.tmpdir());
  if (
    path.dirname(resolved) !== parent ||
    !path.basename(resolved).startsWith("culinote-readiness-smoke-")
  )
    throw new Error("Unsafe cleanup path");
  rmSync(resolved, { recursive: true, force: true });
}
