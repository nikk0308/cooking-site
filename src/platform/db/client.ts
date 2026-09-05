import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getRuntimeConfig } from "@/platform/config/runtime";
let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    const config = getRuntimeConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      connectionTimeoutMillis: config.DATABASE_QUERY_TIMEOUT_MS,
      query_timeout: config.DATABASE_QUERY_TIMEOUT_MS,
      max: 10,
    });
  }
  return pool;
}
export function getDatabase() {
  return drizzle(getPool());
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
