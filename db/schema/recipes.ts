import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { ingredients } from "./ingredients";
import { recipeStatusEnum } from "./enums";
import { units } from "./units";

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 256 }).notNull(),
    slug: varchar("slug", { length: 256 }).notNull(),
    description: text("description"),
    baseServings: integer("base_servings").notNull(),
    status: recipeStatusEnum("status").notNull().default("DRAFT"),
    prepTimeMinutes: integer("prep_time_minutes"),
    cookTimeMinutes: integer("cook_time_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("recipes_slug_unique").on(table.slug),
    check("recipes_title_not_empty", sql`length(trim(${table.title})) > 0`),
    check(
      "recipes_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("recipes_base_servings_positive", sql`${table.baseServings} > 0`),
    check(
      "recipes_prep_time_non_negative",
      sql`${table.prepTimeMinutes} IS NULL OR ${table.prepTimeMinutes} >= 0`,
    ),
    check(
      "recipes_cook_time_non_negative",
      sql`${table.cookTimeMinutes} IS NULL OR ${table.cookTimeMinutes} >= 0`,
    ),
    check(
      "recipes_published_at_required",
      sql`${table.status} <> 'PUBLISHED' OR ${table.publishedAt} IS NOT NULL`,
    ),
  ],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    note: text("note"),
    groupLabel: varchar("group_label", { length: 128 }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recipe_ingredients_recipe_position_unique").on(
      table.recipeId,
      table.position,
    ),
    index("recipe_ingredients_ingredient_idx").on(table.ingredientId),
    index("recipe_ingredients_unit_idx").on(table.unitId),
    check("recipe_ingredients_quantity_positive", sql`${table.quantity} > 0`),
    check("recipe_ingredients_position_positive", sql`${table.position} > 0`),
    check(
      "recipe_ingredients_group_not_empty",
      sql`${table.groupLabel} IS NULL OR length(trim(${table.groupLabel})) > 0`,
    ),
  ],
);

export const recipeSteps = pgTable(
  "recipe_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    instruction: text("instruction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("recipe_steps_recipe_position_unique").on(
      table.recipeId,
      table.position,
    ),
    check("recipe_steps_position_positive", sql`${table.position} > 0`),
    check(
      "recipe_steps_instruction_not_empty",
      sql`length(trim(${table.instruction})) > 0`,
    ),
  ],
);
