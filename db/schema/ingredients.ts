import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from "drizzle-orm/pg-core";
import { ingredientCategories, normalizedNameExpression } from "./categories";

export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }).notNull(),
    normalizedName: text("normalized_name").generatedAlwaysAs(
      normalizedNameExpression,
    ),
    categoryId: uuid("category_id").references(() => ingredientCategories.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ingredients_slug_unique").on(table.slug),
    index("ingredients_normalized_name_idx").on(table.normalizedName),
    index("ingredients_category_idx").on(table.categoryId),
    check("ingredients_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check(
      "ingredients_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);
