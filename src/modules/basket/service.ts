import { basketDocument } from "./document";
import { aggregateBasket } from "./aggregation";
import { recipeRepository } from "@/modules/recipes/repository";
import { scaleQuantityForServings } from "@/modules/recipes/scaling";
import { standardUnits } from "@/modules/units/unit";
import { displayQuantity } from "@/modules/recipes/presentation";
export async function resolveBasket(raw: unknown, repo = recipeRepository()) {
  const document = basketDocument.parse(raw),
    recipes = await repo.resolvePublishedRecipes(
      document.items.map((x) => x.recipeId),
    );
  const names = new Map<string, string>();
  const lines = document.items.flatMap((item) => {
    const recipe = recipes.find((r) => r.id === item.recipeId);
    return (
      recipe?.ingredients.map((x) => {
        names.set(x.ingredient.id, x.ingredient.name);
        return {
          ingredientId: x.ingredient.id,
          quantity: scaleQuantityForServings({
            baseQuantity: x.line.quantity,
            baseServings: recipe.baseServings,
            targetServings: item.selectedServings,
          }).toFixed(),
          unit: x.unit,
        };
      }) ?? []
    );
  });
  const result = aggregateBasket(lines, {
    MASS: standardUnits.g,
    VOLUME: standardUnits.ml,
    COUNT: standardUnits.pcs,
  });
  return {
    items: document.items.map((item) => {
      const recipe = recipes.find((r) => r.id === item.recipeId);
      return {
        ...item,
        title: recipe?.title ?? "Рецепт недоступен",
        slug: recipe?.slug ?? null,
      };
    }),
    ingredients: result.buckets.map((b) => ({
      name: names.get(b.ingredientId)!,
      quantity: displayQuantity(b.quantity, b.unit),
      incompatible: result.incompatibleIngredientIds.includes(b.ingredientId),
    })),
  };
}
