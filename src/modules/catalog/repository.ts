import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/platform/db/client";
import {
  ingredients,
  ingredientAliases,
  ingredientCategories,
  ingredientNutrition,
} from "../../../db/schema";
import { normalizeIngredientName } from "./normalization";

const searchInput = z
  .object({
    query: z.string().max(100),
    categoryId: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z
      .object({ name: z.string().max(256), id: z.uuid() })
      .strict()
      .optional(),
  })
  .strict();
// Intentionally read-only. Catalog mutation still belongs to protected admin APIs.
export function catalogRepository(db = getDatabase()) {
  const select = () =>
    db
      .select({
        ingredient: ingredients,
        nutrition: ingredientNutrition,
        category: ingredientCategories,
      })
      .from(ingredients)
      .leftJoin(
        ingredientNutrition,
        eq(ingredients.id, ingredientNutrition.ingredientId),
      )
      .leftJoin(
        ingredientCategories,
        eq(ingredients.categoryId, ingredientCategories.id),
      );
  return {
    listCategories: () =>
      db
        .select()
        .from(ingredientCategories)
        .orderBy(asc(ingredientCategories.normalizedName))
        .limit(200),
    async search(raw: z.input<typeof searchInput>) {
      const v = searchInput.parse(raw);
      const normalized = normalizeIngredientName(v.query);
      const escaped = normalized.replace(/[\\%_]/g, "\\$&");
      const needle = normalized.length < 3 ? `${escaped}%` : `%${escaped}%`;
      return select()
        .where(
          and(
            v.categoryId ? eq(ingredients.categoryId, v.categoryId) : undefined,
            normalized
              ? sql`${ingredients.id} IN (SELECT id FROM ${ingredients} WHERE normalized_name LIKE ${needle} ESCAPE '\' UNION SELECT ${ingredientAliases.ingredientId} FROM ${ingredientAliases} WHERE ${ingredientAliases.normalizedName} LIKE ${needle} ESCAPE '\')`
              : undefined,
            v.cursor
              ? sql`(${ingredients.normalizedName},${ingredients.id}) > (${v.cursor.name},${v.cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(ingredients.normalizedName), asc(ingredients.id))
        .limit(v.limit);
    },
    async findByIds(ids: string[]) {
      const parsed = z.array(z.uuid()).max(100).parse(ids);
      return parsed.length
        ? select().where(inArray(ingredients.id, parsed)).limit(100)
        : [];
    },
    aliases: (id: string) =>
      db
        .select()
        .from(ingredientAliases)
        .where(eq(ingredientAliases.ingredientId, z.uuid().parse(id)))
        .orderBy(asc(ingredientAliases.normalizedName))
        .limit(100),
  };
}
