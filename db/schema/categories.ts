import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// PostgreSQL and browser search use NFKC, lowercase, ё->е and collapsed spaces.
export const normalizedNameExpression = sql`trim(regexp_replace(replace(lower(normalize("name", NFKC)), 'ё', 'е'), '[[:space:]]+', ' ', 'g'))`;
export const ingredientCategories = pgTable(
  "ingredient_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }).notNull(),
    normalizedName: text("normalized_name").generatedAlwaysAs(
      normalizedNameExpression,
    ),
  },
  (t) => [
    uniqueIndex("ingredient_categories_slug_unique").on(t.slug),
    uniqueIndex("ingredient_categories_name_unique").on(t.normalizedName),
    check(
      "ingredient_categories_name_not_empty",
      sql`length(trim(${t.name})) > 0`,
    ),
    check(
      "ingredient_categories_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);
