import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
export async function isolatedDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for isolated database tests");
  const source = new URL(process.env.DATABASE_URL);
  source.pathname = "/postgres";
  const admin = new Pool({ connectionString: source.toString() });
  const name = "recipes_v01_" + randomUUID().replaceAll("-", "");
  let pool: Pool | undefined;
  try {
    const version = await admin.query("SHOW server_version");
    if (!version.rows[0].server_version.startsWith("18."))
      throw new Error("PostgreSQL 18 required");
    await admin.query('CREATE DATABASE "' + name + '"');
    source.pathname = "/" + name;
    pool = new Pool({ connectionString: source.toString() });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "db/migrations" });
    return {
      db,
      pool,
      url: source.toString(),
      async cleanup() {
        await pool!.end();
        await admin.query('DROP DATABASE "' + name + '"');
        await admin.end();
      },
    };
  } catch (e) {
    await pool?.end();
    await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
    await admin.end();
    throw e;
  }
}
