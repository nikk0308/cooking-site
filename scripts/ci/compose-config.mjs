import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const required = [
  "RECIPES_MEDIA_DIR",
  "RECIPES_APP_IMAGE",
  "POSTGRES_IMAGE",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "RECIPES_POSTGRES_DATA_DIR",
];
const cleanEnvironment = { ...process.env };
for (const name of required) delete cleanEnvironment[name];

const productionEnvironment = {
  RECIPES_MEDIA_DIR: path.join(
    os.tmpdir(),
    "recipes-compose-media-placeholder",
  ),
  ...cleanEnvironment,
  RECIPES_APP_IMAGE: "recipes:test",
  POSTGRES_IMAGE: "postgres:18-alpine",
  DATABASE_URL: "postgresql://recipes:validation@postgres:5432/recipes",
  POSTGRES_PASSWORD: "validation-only",
  RECIPES_POSTGRES_DATA_DIR: path.join(
    os.tmpdir(),
    "recipes-compose-config-placeholder",
  ),
};

function composeConfig(file, environment, stdio = "inherit") {
  return spawnSync("docker", ["compose", "-f", file, "config", "--quiet"], {
    env: environment,
    stdio,
  }).status;
}

if (composeConfig("compose.local.yaml", cleanEnvironment) !== 0)
  process.exit(1);
if (composeConfig("compose.production.yaml", productionEnvironment) !== 0)
  process.exit(1);

for (const missing of required) {
  const environment = { ...productionEnvironment };
  delete environment[missing];
  if (composeConfig("compose.production.yaml", environment, "ignore") === 0) {
    console.error(
      `production Compose unexpectedly accepted missing ${missing}`,
    );
    process.exit(1);
  }
  console.log(`expected rejection: missing ${missing}`);
}
