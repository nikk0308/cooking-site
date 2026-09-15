import { spawnSync } from "node:child_process";
import path from "node:path";

const drizzleKit = path.resolve("node_modules/drizzle-kit/bin.cjs");
const result = spawnSync(
  process.execPath,
  [drizzleKit, "check", "--config", "drizzle.config.ts"],
  {
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://validation:validation@127.0.0.1:1/validation",
    },
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
