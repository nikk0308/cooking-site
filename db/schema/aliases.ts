import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingredients } from "./ingredients";
import { normalizedNameExpression } from "./categories";

export const ingredientAliases = pgTable(
  "ingredient_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 256 }).notNull(),
    normalizedName: text("normalized_name").generatedAlwaysAs(
      normalizedNameExpression,
    ),
  },
  (t) => [
    index("ingredient_aliases_name_trgm_idx").using(
      "gin",
      t.normalizedName.op("gin_trgm_ops"),
    ),
    index("ingredient_aliases_name_prefix_idx").on(
      t.normalizedName.op("text_pattern_ops"),
    ),
    uniqueIndex("ingredient_aliases_identity_unique").on(
      t.ingredientId,
      t.normalizedName,
    ),
    check(
      "ingredient_aliases_name_not_empty",
      sql`length(trim(${t.name})) > 0`,
    ),
  ],
);
