import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { isolatedDatabase } from "../tests/helpers/database";
import { seedDemo } from "../src/modules/recipes/seed";
const fixture = await isolatedDatabase();
const media = await mkdtemp(path.join(os.tmpdir(), "recipes-e2e-media-"));
try {
  await seedDemo(fixture.db);
  const password = randomBytes(24).toString("hex");
  const bootstrapEnvironment = {
    ...process.env,
    DATABASE_URL: fixture.url,
    ADMIN_EMAIL: "test@example.invalid",
    ADMIN_PASSWORD: password,
  };
  const bootstrap = () =>
    spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/admin-create.ts"],
      { env: bootstrapEnvironment, stdio: "pipe" },
    );
  if (bootstrap().status !== 0) throw new Error("Test admin bootstrap failed");
  if (bootstrap().status === 0)
    throw new Error("Duplicate admin bootstrap was accepted");
  const child = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: fixture.url,
        MEDIA_ROOT: media,
        E2E_ADMIN_EMAIL: "test@example.invalid",
        E2E_ADMIN_PASSWORD: password,
      },
    },
  );
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  await fixture.cleanup();
  await rm(media, { recursive: true, force: true });
}
