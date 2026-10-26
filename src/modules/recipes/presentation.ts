import Decimal from "decimal.js";
import type { RecipeAggregate } from "./repository";
import { calculateRecipeNutrition } from "@/modules/nutrition/calculation";
import type { UnitDefinition } from "@/modules/units/unit";
import { standardUnits } from "@/modules/units/unit";
import { convertQuantity } from "@/modules/units/conversion";
export function displayQuantity(quantity: Decimal, unit: UnitDefinition) {
  let target = unit;
  if (unit.dimension === "MASS" || unit.dimension === "VOLUME") {
    const base = unit.dimension === "MASS" ? standardUnits.g : standardUnits.ml;
    const value = convertQuantity({
      quantity: quantity.toFixed(),
      fromUnit: unit,
      toUnit: base,
    });
    target = value.gte(1000)
      ? unit.dimension === "MASS"
        ? standardUnits.kg
        : standardUnits.l
      : base;
  }
  const value =
    target === unit
      ? quantity
      : convertQuantity({
          quantity: quantity.toFixed(),
          fromUnit: unit,
          toUnit: target,
        });
  return `${value.toDecimalPlaces(6).toFixed()} ${target.symbol}`;
}
export function recipeNutrition(recipe: RecipeAggregate) {
  return calculateRecipeNutrition({
    servings: recipe.baseServings,
    ingredients: recipe.ingredients.map((x) => ({
      ingredientId: x.ingredient.id,
      quantity: x.line.quantity,
      unit: x.unit,
    })),
    profiles: recipe.ingredients.flatMap((x) =>
      x.nutrition && x.basisUnit
        ? [{ ...x.nutrition, basisUnit: x.basisUnit }]
        : [],
    ),
  });
}
