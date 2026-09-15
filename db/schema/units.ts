import { sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { measurementDimensionEnum } from "./enums";

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    dimension: measurementDimensionEnum("dimension").notNull(),
    factorToBase: numeric("factor_to_base", { precision: 24, scale: 12 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("units_code_unique").on(table.code),
    check("units_code_not_empty", sql`length(trim(${table.code})) > 0`),
    check("units_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("units_symbol_not_empty", sql`length(trim(${table.symbol})) > 0`),
    check(
      "units_factor_contract",
      sql`(${table.dimension} = 'CUSTOM' AND ${table.factorToBase} IS NULL) OR (${table.dimension} <> 'CUSTOM' AND ${table.factorToBase} IS NOT NULL AND ${table.factorToBase} > 0)`,
    ),
  ],
);

export const standardUnitIds = {
  g: "10000000-0000-4000-8000-000000000001",
  kg: "10000000-0000-4000-8000-000000000002",
  ml: "10000000-0000-4000-8000-000000000003",
  l: "10000000-0000-4000-8000-000000000004",
  tsp: "10000000-0000-4000-8000-000000000005",
  tbsp: "10000000-0000-4000-8000-000000000006",
  pcs: "10000000-0000-4000-8000-000000000007",
} as const;
