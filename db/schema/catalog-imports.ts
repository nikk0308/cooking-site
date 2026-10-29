import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingredients } from "./ingredients";

export const catalogRevision = pgTable(
  "catalog_revision",
  {
    id: integer("id").primaryKey(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [check("catalog_revision_singleton", sql`${t.id} = 1`)],
);
export const catalogSourceRecords = pgTable(
  "catalog_source_records",
  {
    namespace: varchar("namespace", { length: 128 }).notNull(),
    externalId: varchar("external_id", { length: 256 }).notNull(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    mode: varchar("mode", { length: 16 })
      .$type<"SOURCE" | "LINK_ONLY">()
      .notNull(),
    appliedHash: varchar("applied_hash", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.namespace, t.externalId] }),
    uniqueIndex("catalog_source_ingredient_unique").on(t.ingredientId),
    check("catalog_source_mode", sql`${t.mode} IN ('SOURCE','LINK_ONLY')`),
  ],
);
export const catalogImportRuns = pgTable("catalog_import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  namespace: varchar("namespace", { length: 128 }).notNull(),
  fileHash: varchar("file_hash", { length: 64 }).notNull(),
  planHash: varchar("plan_hash", { length: 64 }).notNull(),
  batch: varchar("batch", { length: 256 }),
  rowCount: integer("row_count").notNull(),
  report: text("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
