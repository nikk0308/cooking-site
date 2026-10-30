import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { isolatedDatabase } from "../helpers/database";
import { inventory } from "../../scripts/backup/inventory";
let fixture: Awaited<ReturnType<typeof isolatedDatabase>>;
let reader: Pool;
let role: string;
let predicate: string;
const accepted = async () =>
  (await reader.query(predicate)).rows[0]["?column?"];
async function grantCycle(
  grant: string,
  revoke: string,
  exercise?: () => Promise<void>,
) {
  expect(await accepted()).toBe(true);
  try {
    await fixture.pool.query(grant);
    expect(await accepted()).toBe(false);
    await exercise?.();
  } finally {
    await fixture.pool.query(revoke);
  }
  expect(await accepted()).toBe(true);
}
beforeAll(async () => {
  fixture = await isolatedDatabase();
  expect(
    (await fixture.pool.query("SHOW server_version")).rows[0].server_version,
  ).toMatch(/^18\.6\b/);
  role = "broker_reader_" + randomUUID().replaceAll("-", "");
  await fixture.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD 'synthetic-broker-only'; GRANT USAGE ON SCHEMA public,drizzle TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA public,drizzle TO ${role}; GRANT SELECT ON ALL SEQUENCES IN SCHEMA public,drizzle TO ${role}; GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO ${role}`,
  );
  const url = new URL(fixture.url);
  url.username = role;
  url.password = "synthetic-broker-only";
  reader = new Pool({ connectionString: url.href });
  predicate = (await readFile("scripts/backup/docker_broker.py", "utf8"))
    .split('READ_ROLE_SQL = """')[1]
    .split('"""')[0];
  if (!(await accepted())) {
    console.log("SYNTHETIC_BASELINE_PRIVILEGE_DIAGNOSTICS", {
      schemas: (
        await reader.query(
          "SELECT nspname FROM pg_namespace WHERE has_schema_privilege(oid,'CREATE') OR nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)",
        )
      ).rows,
      relations: (
        await reader.query(
          "SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES'))",
        )
      ).rows,
      routines: (
        await reader.query(
          "SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','drizzle') AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR (p.prosecdef AND has_function_privilege(p.oid,'EXECUTE')))",
        )
      ).rows,
      parameters: (
        await reader.query(
          "SELECT parname FROM pg_parameter_acl WHERE has_parameter_privilege(parname,'ALTER SYSTEM')",
        )
      ).rows,
    });
  }
}, 30000);
afterAll(async () => {
  await reader?.end();
  if (fixture) {
    await fixture.cleanup();
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await admin.end();
    }
  }
});
it("accepts only the required SELECT/schema-USAGE/function contract and real v0.2 inventory", async () => {
  expect(await accepted()).toBe(true);
  const c = await reader.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect((await inventory(c, "v0.2")).schema.tables).toHaveLength(14);
    await c.query("SELECT system_identifier::text FROM pg_control_system()");
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});
for (const privilege of [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
])
  it(`denies effective table ${privilege} and accepts after revoke`, async () => {
    await grantCycle(
      `GRANT ${privilege} ON recipes TO ${role}`,
      `REVOKE ${privilege} ON recipes FROM ${role}`,
    );
  });
for (const privilege of ["UPDATE", "INSERT", "REFERENCES"])
  it(`denies column ${privilege} independently of table-wide grants`, async () => {
    await grantCycle(
      `GRANT ${privilege}(title) ON recipes TO ${role}`,
      `REVOKE ${privilege}(title) ON recipes FROM ${role}`,
      privilege === "UPDATE"
        ? async () => {
            await reader.query("UPDATE recipes SET title=title WHERE false");
          }
        : undefined,
    );
  });
it("denies effective PUBLIC column grants without relying on direct role grants", async () => {
  await grantCycle(
    "GRANT INSERT(title) ON recipes TO PUBLIC",
    "REVOKE INSERT(title) ON recipes FROM PUBLIC",
  );
});
for (const privilege of ["UPDATE", "USAGE"])
  it(`denies sequence ${privilege}, including actual state-changing capability`, async () => {
    const seq = (
      await fixture.pool.query(
        "SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname='drizzle' LIMIT 1",
      )
    ).rows[0].name;
    await grantCycle(
      `GRANT ${privilege} ON SEQUENCE ${seq} TO ${role}`,
      `REVOKE ${privilege} ON SEQUENCE ${seq} FROM ${role}`,
      async () => {
        if (privilege === "USAGE")
          await reader.query("SELECT nextval($1::regclass)", [seq]);
        else await reader.query("SELECT setval($1::regclass,10,true)", [seq]);
      },
    );
  });
it("denies PUBLIC sequence mutation grants", async () => {
  await fixture.pool.query("CREATE SEQUENCE public.broker_test_seq");
  try {
    await grantCycle(
      "GRANT USAGE ON SEQUENCE broker_test_seq TO PUBLIC",
      "REVOKE USAGE ON SEQUENCE broker_test_seq FROM PUBLIC",
    );
  } finally {
    await fixture.pool.query("DROP SEQUENCE public.broker_test_seq");
  }
});
it("checks writable views and their column grants", async () => {
  await fixture.pool.query(
    `CREATE VIEW broker_test_view AS SELECT title FROM recipes; GRANT SELECT ON broker_test_view TO ${role}`,
  );
  try {
    await grantCycle(
      `GRANT UPDATE(title) ON broker_test_view TO ${role}`,
      `REVOKE UPDATE(title) ON broker_test_view FROM ${role}`,
    );
  } finally {
    await fixture.pool.query("DROP VIEW broker_test_view");
  }
});
it("denies materialized-view MAINTAIN", async () => {
  await fixture.pool.query(
    `CREATE MATERIALIZED VIEW broker_test_mv AS SELECT title FROM recipes WITH NO DATA; GRANT SELECT ON broker_test_mv TO ${role}`,
  );
  try {
    await grantCycle(
      `GRANT MAINTAIN ON broker_test_mv TO ${role}`,
      `REVOKE MAINTAIN ON broker_test_mv FROM ${role}`,
    );
  } finally {
    await fixture.pool.query("DROP MATERIALIZED VIEW broker_test_mv");
  }
});
for (const schema of ["public", "drizzle", "pg_catalog"])
  it(`denies schema CREATE on ${schema}`, async () => {
    await grantCycle(
      `GRANT CREATE ON SCHEMA ${schema} TO ${role}`,
      `REVOKE CREATE ON SCHEMA ${schema} FROM ${role}`,
    );
  });
it("denies database CREATE", async () => {
  const name = new URL(fixture.url).pathname.slice(1);
  await grantCycle(
    `GRANT CREATE ON DATABASE ${name} TO ${role}`,
    `REVOKE CREATE ON DATABASE ${name} FROM ${role}`,
  );
});
for (const flag of [
  "SUPERUSER",
  "CREATEDB",
  "CREATEROLE",
  "REPLICATION",
  "BYPASSRLS",
])
  it(`denies ${flag}`, async () => {
    await grantCycle(
      `ALTER ROLE ${role} ${flag}`,
      `ALTER ROLE ${role} NO${flag}`,
    );
  });
it("denies membership even in a read-only predefined role", async () => {
  await grantCycle(
    `GRANT pg_read_all_data TO ${role}`,
    `REVOKE pg_read_all_data FROM ${role}`,
  );
});
it("fails closed on unreviewed user schemas", async () => {
  await grantCycle(
    "CREATE SCHEMA broker_unreviewed",
    "DROP SCHEMA broker_unreviewed",
  );
});
it("fails closed on executable user SECURITY DEFINER routines, but accepts after EXECUTE revoke", async () => {
  await fixture.pool.query(
    "CREATE FUNCTION public.broker_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
  );
  try {
    expect(await accepted()).toBe(false);
    await fixture.pool.query(
      "REVOKE EXECUTE ON FUNCTION public.broker_definer() FROM PUBLIC",
    );
    expect(await accepted()).toBe(true);
  } finally {
    await fixture.pool.query("DROP FUNCTION public.broker_definer()");
  }
});
it("denies ALTER SYSTEM parameter privileges", async () => {
  await grantCycle(
    `GRANT ALTER SYSTEM ON PARAMETER work_mem TO ${role}`,
    `REVOKE ALTER SYSTEM ON PARAMETER work_mem FROM ${role}`,
  );
});
it("denies restricted parameter SET but permits ordinary session settings", async () => {
  await grantCycle(
    `GRANT SET ON PARAMETER session_replication_role TO ${role}`,
    `REVOKE SET ON PARAMETER session_replication_role FROM ${role}`,
  );
  await fixture.pool.query(`GRANT SET ON PARAMETER work_mem TO ${role}`);
  try {
    expect(await accepted()).toBe(true);
    await reader.query("SET work_mem='4MB'");
  } finally {
    await fixture.pool.query(`REVOKE SET ON PARAMETER work_mem FROM ${role}`);
  }
});
it("does not exempt other system catalog relations from write checks", async () => {
  await grantCycle(
    `GRANT UPDATE(relname) ON pg_catalog.pg_class TO ${role}`,
    `REVOKE UPDATE(relname) ON pg_catalog.pg_class FROM ${role}`,
  );
});
it("checks foreign relation write ACLs without connecting to an external target", async () => {
  await fixture.pool.query(
    `CREATE FOREIGN DATA WRAPPER broker_no_handler; CREATE SERVER broker_no_network FOREIGN DATA WRAPPER broker_no_handler; CREATE FOREIGN TABLE broker_foreign(title text) SERVER broker_no_network; GRANT SELECT ON broker_foreign TO ${role}`,
  );
  try {
    await grantCycle(
      `GRANT UPDATE(title) ON broker_foreign TO ${role}`,
      `REVOKE UPDATE(title) ON broker_foreign FROM ${role}`,
    );
  } finally {
    await fixture.pool.query(
      "DROP FOREIGN TABLE broker_foreign; DROP SERVER broker_no_network; DROP FOREIGN DATA WRAPPER broker_no_handler",
    );
  }
});
it("denies ownership even after schema CREATE is removed", async () => {
  await fixture.pool.query(`GRANT CREATE ON SCHEMA public TO ${role}`);
  try {
    await reader.query(
      "CREATE TYPE public.broker_owned_type AS ENUM ('synthetic')",
    );
  } finally {
    await fixture.pool.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
  }
  try {
    expect(await accepted()).toBe(false);
  } finally {
    await fixture.pool.query("DROP TYPE public.broker_owned_type");
  }
  expect(await accepted()).toBe(true);
});
