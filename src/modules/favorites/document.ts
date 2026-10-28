import { z } from "zod";
import {
  recipeKey,
  recipeReference,
  type RecipeReference,
} from "@/modules/recipes/reference";
export const favoritesDocument = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(recipeReference).max(500),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map(recipeKey)).size === v.items.length,
    "Duplicate favorite",
  );
export type FavoritesDocument = z.infer<typeof favoritesDocument>;
export async function resolveFavorites<T>(
  refs: readonly RecipeReference[],
  resolve: (ref: RecipeReference) => Promise<T | null | undefined>,
) {
  return Promise.all(
    refs.map(async (reference) => {
      try {
        const recipe = await resolve(reference);
        return {
          reference,
          availability:
            recipe == null ? ("UNAVAILABLE" as const) : ("AVAILABLE" as const),
          recipe: recipe ?? null,
        };
      } catch {
        return { reference, availability: "UNRESOLVED" as const, recipe: null };
      }
    }),
  );
}
