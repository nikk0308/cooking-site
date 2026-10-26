import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import {
  recipes,
  recipeIngredients,
  recipeSteps,
  ingredients,
  units,
  ingredientNutrition,
  media,
} from "../../../db/schema";
import { ingredientInput, recipeInput } from "./input";

export function recipeRepository(db = getDatabase()) {
  async function aggregates(where: SQL | undefined, limit = 100) {
    const rows = await db
      .select({ recipe: recipes, cover: media })
      .from(recipes)
      .leftJoin(media, eq(recipes.coverMediaId, media.id))
      .where(where)
      .orderBy(desc(recipes.createdAt))
      .limit(limit);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.recipe.id);
    const [lines, steps] = await Promise.all([
      db
        .select({
          line: recipeIngredients,
          ingredient: ingredients,
          unit: units,
          nutrition: ingredientNutrition,
        })
        .from(recipeIngredients)
        .innerJoin(
          ingredients,
          eq(recipeIngredients.ingredientId, ingredients.id),
        )
        .innerJoin(units, eq(recipeIngredients.unitId, units.id))
        .leftJoin(
          ingredientNutrition,
          eq(ingredients.id, ingredientNutrition.ingredientId),
        )
        .where(inArray(recipeIngredients.recipeId, ids))
        .orderBy(asc(recipeIngredients.position)),
      db
        .select()
        .from(recipeSteps)
        .where(inArray(recipeSteps.recipeId, ids))
        .orderBy(asc(recipeSteps.position)),
    ]);
    const allUnits = await db.select().from(units);
    return rows.map(({ recipe, cover }) => ({
      ...recipe,
      cover,
      ingredients: lines
        .filter((x) => x.line.recipeId === recipe.id)
        .map((x) => ({
          ...x,
          basisUnit:
            allUnits.find((u) => u.id === x.nutrition?.basisUnitId) ?? null,
        })),
      steps: steps.filter((x) => x.recipeId === recipe.id),
    }));
  }
  return {
    listPublishedRecipes: () => aggregates(eq(recipes.status, "PUBLISHED")),
    findPublishedRecipeBySlug: async (slug: string) =>
      (
        await aggregates(
          and(eq(recipes.status, "PUBLISHED"), eq(recipes.slug, slug)),
          1,
        )
      )[0],
    resolvePublishedRecipes: (ids: string[]) =>
      ids.length
        ? aggregates(
            and(eq(recipes.status, "PUBLISHED"), inArray(recipes.id, ids)),
          )
        : Promise.resolve([]),
    listAdminRecipes: () =>
      db.select().from(recipes).orderBy(desc(recipes.updatedAt)),
    findAdminRecipe: async (id: string) =>
      (await aggregates(eq(recipes.id, id), 1))[0],
    listIngredients: () =>
      db
        .select({ ingredient: ingredients, nutrition: ingredientNutrition })
        .from(ingredients)
        .leftJoin(
          ingredientNutrition,
          eq(ingredients.id, ingredientNutrition.ingredientId),
        )
        .orderBy(asc(ingredients.name)),
    listUnits: () => db.select().from(units).orderBy(asc(units.code)),
    async saveRecipe(raw: unknown) {
      const v = recipeInput.parse(raw);
      return db.transaction(async (tx) => {
        const { id, ingredients: lines, steps, ...row } = v;
        let previous: typeof recipes.$inferSelect | undefined;
        if (id) {
          previous = (
            await tx
              .select()
              .from(recipes)
              .where(eq(recipes.id, id))
              .for("update")
          )[0];
          if (!previous) throw new Error("Recipe not found");
        }
        const values = {
          ...row,
          updatedAt: new Date(),
          publishedAt:
            previous?.publishedAt ??
            (v.status === "PUBLISHED" ? new Date() : null),
        };
        const saved = id
          ? (
              await tx
                .update(recipes)
                .set(values)
                .where(eq(recipes.id, id))
                .returning()
            )[0]
          : (await tx.insert(recipes).values(values).returning())[0];
        await tx
          .delete(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, saved.id));
        await tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, saved.id));
        if (lines.length)
          await tx.insert(recipeIngredients).values(
            lines.map((line, i) => ({
              ...line,
              groupLabel: line.groupLabel || null,
              recipeId: saved.id,
              position: i + 1,
            })),
          );
        if (steps.length)
          await tx.insert(recipeSteps).values(
            steps.map((instruction, i) => ({
              instruction,
              recipeId: saved.id,
              position: i + 1,
            })),
          );
        return saved.id;
      });
    },
    async saveIngredient(raw: unknown) {
      const v = ingredientInput.parse(raw);
      return db.transaction(async (tx) => {
        const { id, nutrition, ...row } = v;
        const saved = id
          ? (
              await tx
                .update(ingredients)
                .set({ ...row, updatedAt: new Date() })
                .where(eq(ingredients.id, id))
                .returning()
            )[0]
          : (await tx.insert(ingredients).values(row).returning())[0];
        if (!saved) throw new Error("Ingredient not found");
        if (nutrition)
          await tx
            .insert(ingredientNutrition)
            .values({ ...nutrition, ingredientId: saved.id })
            .onConflictDoUpdate({
              target: ingredientNutrition.ingredientId,
              set: { ...nutrition, updatedAt: new Date() },
            });
        else
          await tx
            .delete(ingredientNutrition)
            .where(eq(ingredientNutrition.ingredientId, saved.id));
        return saved.id;
      });
    },
  };
}
export type RecipeAggregate = Awaited<
  ReturnType<ReturnType<typeof recipeRepository>["listPublishedRecipes"]>
>[number];
