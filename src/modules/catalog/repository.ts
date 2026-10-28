import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
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
      const needle = `%${normalizeIngredientName(v.query).replace(/[\\%_]/g, "\\$&")}%`;
      return select()
        .where(
          and(
            v.categoryId ? eq(ingredients.categoryId, v.categoryId) : undefined,
            or(
              sql`${ingredients.normalizedName} LIKE ${needle} ESCAPE '\'`,
              sql`EXISTS (SELECT 1 FROM ${ingredientAliases} WHERE ${ingredientAliases.ingredientId} = ${ingredients.id} AND ${ingredientAliases.normalizedName} LIKE ${needle} ESCAPE '\')`,
            ),
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
