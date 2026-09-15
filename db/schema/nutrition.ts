import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ingredients } from "./ingredients";
import { units } from "./units";

export const ingredientNutrition = pgTable(
  "ingredient_nutrition",
  {
    ingredientId: uuid("ingredient_id")
      .primaryKey()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    basisQuantity: numeric("basis_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    basisUnitId: uuid("basis_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    caloriesKcal: numeric("calories_kcal", {
      precision: 18,
      scale: 6,
    }).notNull(),
    proteinG: numeric("protein_g", { precision: 18, scale: 6 }).notNull(),
    fatG: numeric("fat_g", { precision: 18, scale: 6 }).notNull(),
    carbohydratesG: numeric("carbohydrates_g", {
      precision: 18,
      scale: 6,
    }).notNull(),
    sourceNote: text("source_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ingredient_nutrition_basis_unit_idx").on(table.basisUnitId),
    check(
      "ingredient_nutrition_basis_positive",
      sql`${table.basisQuantity} > 0`,
    ),
    check(
      "ingredient_nutrition_calories_non_negative",
      sql`${table.caloriesKcal} >= 0`,
    ),
    check(
      "ingredient_nutrition_protein_non_negative",
      sql`${table.proteinG} >= 0`,
    ),
    check("ingredient_nutrition_fat_non_negative", sql`${table.fatG} >= 0`),
    check(
      "ingredient_nutrition_carbohydrates_non_negative",
      sql`${table.carbohydratesG} >= 0`,
    ),
  ],
);
