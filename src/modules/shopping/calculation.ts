import { aggregateBasket } from "@/modules/basket/aggregation";
import { calculateRecipeNutrition } from "@/modules/nutrition/calculation";
import { scaleQuantityForServings } from "@/modules/recipes/scaling";
import {
  productKey,
  recipeDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
import { recipeKey } from "@/modules/recipes/reference";
import { standardUnits } from "@/modules/units/unit";
import { shoppingDocument, type ShoppingDocument } from "./document";

export function resolveShopping(
  raw: ShoppingDocument,
  available: readonly RecipeDocument[],
) {
  const doc = shoppingDocument.parse(raw);
  const recipes = new Map(
    available.map((r) => {
      const parsed = recipeDocument.parse(r);
      return [recipeKey(parsed.reference), parsed] as const;
    }),
  );
  const unavailable = doc.recipes
    .filter((r) => !recipes.has(recipeKey(r.reference)))
    .map((r) => r.reference);
  const names = new Map<
    string,
    { name: string; product: RecipeDocument["ingredients"][number]["product"] }
  >();
  const lines: Parameters<typeof aggregateBasket>[0][number][] = [];
  const dimensions = new Map<string, Set<string>>();
  const add = (
    line:
      | RecipeDocument["ingredients"][number]
      | ShoppingDocument["manual"][number],
    source: string,
    quantity: string,
  ) => {
    const identity =
      productKey(line.product) +
      (line.unit.dimension === "CUSTOM" ? `:${source}` : "");
    names.set(identity, { name: line.name, product: line.product });
    const key = productKey(line.product),
      seen = dimensions.get(key) ?? new Set<string>();
    seen.add(line.unit.dimension);
    dimensions.set(key, seen);
    lines.push({ ingredientId: identity, quantity, unit: line.unit });
  };
  for (const item of doc.recipes) {
    const recipe = recipes.get(recipeKey(item.reference));
    for (const line of recipe?.ingredients ?? [])
      add(
        line,
        `${recipeKey(item.reference)}:${line.id}`,
        scaleQuantityForServings({
          baseQuantity: line.quantity,
          baseServings: recipe!.baseServings,
          targetServings: item.selectedServings,
        }).toFixed(),
      );
  }
  for (const item of doc.manual) add(item, `manual:${item.id}`, item.quantity);
  const result = aggregateBasket(lines, {
    MASS: standardUnits.g,
    VOLUME: standardUnits.ml,
    COUNT: standardUnits.pcs,
  });
  return {
    unavailable,
    items: result.buckets.map((bucket) => {
      const id = `${bucket.ingredientId}:${bucket.dimension}`;
      const edit = doc.overrides.find((o) => o.id === id);
      const product = names.get(bucket.ingredientId)!;
      return {
        id,
        ...product,
        unit: bucket.unit,
        calculatedQuantity: bucket.quantity.toFixed(),
        quantity: edit?.quantity ?? bucket.quantity.toFixed(),
        purchased: edit?.purchased ?? false,
        incompatible:
          (dimensions.get(productKey(product.product))?.size ?? 0) > 1,
      };
    }),
  };
}

export function documentNutrition(raw: RecipeDocument) {
  const recipe = recipeDocument.parse(raw);
  const result = calculateRecipeNutrition({
    servings: recipe.baseServings,
    ingredients: recipe.ingredients.map((x) => ({
      ingredientId: x.id,
      quantity: x.quantity,
      unit: x.unit,
    })),
    profiles: recipe.ingredients.flatMap((x) =>
      x.nutrition ? [{ ingredientId: x.id, ...x.nutrition }] : [],
    ),
  });
  const strings = (n: typeof result.total) => ({
    caloriesKcal: n.caloriesKcal.toFixed(),
    proteinG: n.proteinG.toFixed(),
    fatG: n.fatG.toFixed(),
    carbohydratesG: n.carbohydratesG.toFixed(),
  });
  return {
    ...result,
    knownTotal: strings(result.total),
    knownPerServing: strings(result.perServing),
    total: result.coverage.complete ? strings(result.total) : null,
    perServing: result.coverage.complete ? strings(result.perServing) : null,
  };
}
