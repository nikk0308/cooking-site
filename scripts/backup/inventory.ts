import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
export const v01Tables = [
  "admin_sessions",
  "admin_users",
  "ingredient_nutrition",
  "ingredients",
  "media",
  "recipe_ingredients",
  "recipe_steps",
  "recipes",
  "units",
].sort();
export const v02Tables = [
  ...v01Tables,
  "ingredient_categories",
  "ingredient_aliases",
  "catalog_source_records",
  "catalog_import_runs",
  "catalog_revision",
].sort();
export const triggerTables = [
  "ingredients",
  "ingredient_categories",
  "ingredient_aliases",
  "ingredient_nutrition",
  "catalog_source_records",
  "units",
].sort();
export function digest(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")),
        )
      : v,
  );
}
const metaSchema = z
  .object({
    tables: z.array(z.string()),
    columns: z.array(z.array(z.unknown())),
    constraints: z.array(z.array(z.unknown())),
    indexes: z.array(z.tuple([z.string(), z.string(), z.string()])),
    extensions: z.array(z.tuple([z.string(), z.string()])),
    functions: z.array(z.tuple([z.string(), z.string(), z.string()])),
    triggers: z.array(
      z.tuple([z.string(), z.string(), z.string(), z.string()]),
    ),
    enums: z.array(z.array(z.unknown())),
    units: z.array(z.record(z.string(), z.unknown())),
    migrations: z.array(
      z.tuple([z.number(), z.string(), z.union([z.number(), z.string()])]),
    ),
  })
  .strict();
export type Inventory = {
  format: 2;
  schemaVersion: "v0.1" | "v0.2";
  schema: z.infer<typeof metaSchema>;
  schemaHash: string;
  data: Record<string, { count: string; sha256: string }>;
};
const enumChecks = [
  {
    table: "catalog_source_records",
    name: "catalog_source_mode",
    column: "mode",
    values: ["SOURCE", "LINK_ONLY"],
  },
  {
    table: "ingredient_nutrition",
    name: "ingredient_nutrition_source_kind",
    column: "source_kind",
    values: ["UNKNOWN", "MANUAL", "REFERENCE", "IMPORT"],
  },
];
export function comparableSchema(s: Inventory["schema"]) {
  return {
    ...s,
    constraints: s.constraints.map((c) => {
      const known = enumChecks.find((k) => k.table === c[0] && k.name === c[1]);
      if (!known) return c;
      const literals = known.values.map((v) => `'${v}'::character varying`);
      const original = `CHECK (((${known.column})::text = ANY ((ARRAY[${literals.join(", ")}])::text[])))`;
      const restored = `CHECK (((${known.column})::text = ANY (ARRAY[${literals.map((v) => `(${v})::text`).join(", ")}])))`;
      if (c[2] !== original && c[2] !== restored)
        throw new Error("UNRECOGNIZED_ENUM_CHECK_DEFINITION");
      return [
        c[0],
        c[1],
        `CHECK_ENUM_TEXT(${known.column},${known.values.join(",")})`,
        ...c.slice(3),
      ];
    }),
  };
}
export function comparableInventory(s: Inventory) {
  return { ...s, schema: comparableSchema(s.schema) };
}
export function validateInventory(raw: unknown): Inventory {
  const s = z
    .object({
      format: z.literal(2),
      schemaVersion: z.enum(["v0.1", "v0.2"]),
      schema: metaSchema,
      schemaHash: z.string().regex(/^[a-f0-9]{64}$/),
      data: z.record(
        z.string(),
        z
          .object({
            count: z.string().regex(/^\d+$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      ),
    })
    .strict()
    .parse(raw);
  validateSchema(s.schema, s.schemaVersion);
  if (
    s.schemaHash !== digest(canonical(comparableSchema(s.schema))) ||
    canonical(Object.keys(s.data).sort()) !== canonical(s.schema.tables)
  )
    throw new Error("INVENTORY_COVERAGE_MISMATCH");
  return s;
}
export function validateSchema(raw: unknown, version: "v0.1" | "v0.2") {
  const s = metaSchema.parse(raw),
    expected = version === "v0.1" ? v01Tables : v02Tables;
  if (canonical(s.tables) !== canonical(expected))
    throw new Error("INVENTORY_TABLE_SET_MISMATCH");
  if (s.migrations.length !== (version === "v0.1" ? 2 : 4))
    throw new Error("MIGRATION_LEDGER_INCOMPLETE");
  if (s.constraints.some((c) => c[3] !== true))
    throw new Error("UNVALIDATED_CONSTRAINT");
  if (version === "v0.2") {
    for (const k of enumChecks)
      if (!s.constraints.some((c) => c[0] === k.table && c[1] === k.name))
        throw new Error("MISSING_ENUM_CHECK");
    comparableSchema(s);
    if (!s.extensions.some((e) => e[0] === "pg_trgm"))
      throw new Error("MISSING_PG_TRGM");
    if (
      !s.functions.some(
        (f) =>
          f[0] === "bump_catalog_revision" &&
          /UPDATE catalog_revision SET revision = revision \+ 1/.test(f[2]),
      )
    )
      throw new Error("MISSING_REVISION_FUNCTION");
    const triggers = s.triggers.filter(
      (t) => t[1] === `${t[0]}_catalog_revision`,
    );
    if (
      canonical(triggers.map((t) => t[0]).sort()) !==
        canonical(triggerTables) ||
      triggers.some(
        (t) =>
          t[2] !== "O" ||
          !t[3].includes("bump_catalog_revision()") ||
          !t[3].includes("FOR EACH STATEMENT"),
      )
    )
      throw new Error("REVISION_TRIGGER_CONTRACT_MISMATCH");
    for (const index of [
      "ingredients_name_trgm_idx",
      "ingredient_aliases_name_trgm_idx",
    ])
      if (!s.indexes.some((i) => i[1] === index && i[2].includes("USING gin")))
        throw new Error("MISSING_SEARCH_INDEX");
    for (const [table, column] of [
      ["ingredients", "normalized_name"],
      ["ingredient_aliases", "normalized_name"],
      ["ingredient_categories", "normalized_name"],
    ])
      if (
        !s.columns.some(
          (c) =>
            c[0] === table &&
            c[1] === column &&
            c[6] === "ALWAYS" &&
            typeof c[7] === "string",
        )
      )
        throw new Error("MISSING_GENERATED_COLUMN");
  }
  return s;
}
export async function inventory(
  client: PoolClient,
  version: "v0.1" | "v0.2",
): Promise<Inventory> {
  const query = await readFile(
    new URL("./inventory.sql", import.meta.url),
    "utf8",
  );
  const schema = validateSchema(
    (await client.query(query)).rows[0].inventory,
    version,
  );
  const data: Inventory["data"] = {};
  for (const table of schema.tables) {
    // Identifier is a validated member of the fixed versioned allowlist above.
    await client.query(
      `DECLARE inventory_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS value FROM public."${table}" t ORDER BY (to_jsonb(t)::text) COLLATE "C"`,
    );
    const hash = createHash("sha256");
    let count = BigInt(0);
    try {
      while (true) {
        const rows = (await client.query("FETCH 1000 FROM inventory_rows"))
          .rows;
        if (!rows.length) break;
        for (const r of rows) {
          const value = r.value as string;
          hash.update(String(Buffer.byteLength(value)) + ":" + value + "\n");
          count++;
        }
      }
    } finally {
      await client.query("CLOSE inventory_rows");
    }
    data[table] = { count: count.toString(), sha256: hash.digest("hex") };
  }
  return {
    format: 2,
    schemaVersion: version,
    schema,
    schemaHash: digest(canonical(comparableSchema(schema))),
    data,
  };
}
