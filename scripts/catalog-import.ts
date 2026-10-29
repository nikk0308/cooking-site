import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { catalogImporter } from "../src/modules/catalog/importer";
import { importMaxBytes } from "../src/modules/catalog/import-format";
import { stat } from "node:fs/promises";
const { values } = parseArgs({
  options: {
    database: { type: "string" },
    file: { type: "string" },
    format: { type: "string" },
    apply: { type: "string" },
    decisions: { type: "string" },
  },
});
// Deliberately never falls back to DATABASE_URL or logs the connection string.
if (
  !values.database ||
  !values.file ||
  !["csv", "json"].includes(values.format ?? "")
)
  throw new Error(
    "Explicit --database URL --file path --format csv|json required. Preview is the default; --apply PLAN_HASH explicitly confirms one part.",
  );
if ((await stat(values.file)).size > importMaxBytes)
  throw new Error(
    "Split data into parts <=500 records and <=1 MiB before previewing each part.",
  );
const bytes = await readFile(values.file);
const decisions = values.decisions
  ? (JSON.parse(await readFile(values.decisions, "utf8")) as unknown)
  : {};
const pool = new Pool({
  connectionString: values.database,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 10000,
});
try {
  const service = catalogImporter(drizzle(pool)),
    format = values.format as "csv" | "json";
  console.log(
    JSON.stringify(
      values.apply
        ? await service.apply(bytes, format, values.apply, decisions)
        : await service.preview(bytes, format, decisions),
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Catalog operation failed. No credentials are printed. Refresh preview, check file/decisions and the explicitly selected disposable database.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
