import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "@/platform/db/client";
import { checkReadiness } from "@/platform/health/ready";
const url = process.env.DATABASE_URL;
const pool = url
  ? new Pool({
      connectionString: url,
      connectionTimeoutMillis: 2000,
      query_timeout: 2000,
    })
  : undefined;
describe.skipIf(!url)("PostgreSQL readiness foundation", () => {
  afterAll(async () => {
    await pool?.end();
    await closePool();
  });
  it("connects to real PostgreSQL 18 without schema dependencies", async () => {
    const result = await pool!.query<{ server_version: string }>(
      "SHOW server_version",
    );
    expect(result.rows[0].server_version).toMatch(/^18\./);
    expect((await pool!.query("SELECT 1 AS ready")).rows[0]).toEqual({
      ready: 1,
    });
    await expect(checkReadiness()).resolves.toEqual({ status: "ready" });
  });
  it("fails promptly when PostgreSQL is unavailable", async () => {
    const unavailable = new Pool({
      connectionString: "postgresql://recipes:invalid@127.0.0.1:1/recipes",
      connectionTimeoutMillis: 500,
    });
    await expect(unavailable.query("SELECT 1")).rejects.toThrow();
    await unavailable.end();
  });
});
