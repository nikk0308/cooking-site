import Decimal from "decimal.js";
import { parseDecimal } from "@/shared/decimal/decimal";
import {
  convertQuantity,
  UnitConversionError,
} from "@/modules/units/conversion";
import type { UnitDefinition } from "@/modules/units/unit";

export type Nutrients = Readonly<{
  caloriesKcal: Decimal;
  proteinG: Decimal;
  fatG: Decimal;
  carbohydratesG: Decimal;
}>;
export type NutritionProfile = Readonly<{
  ingredientId: string;
  basisQuantity: string;
  basisUnit: UnitDefinition;
  caloriesKcal: string;
  proteinG: string;
  fatG: string;
  carbohydratesG: string;
}>;
export type NutritionIngredient = Readonly<{
  ingredientId: string;
  quantity: string;
  unit: UnitDefinition;
}>;
export type MissingNutritionReason =
  "MISSING_PROFILE" | "INCOMPATIBLE_DIMENSION" | "NON_CONVERTIBLE_UNIT";

const zero = (): Nutrients => ({
  caloriesKcal: new Decimal(0),
  proteinG: new Decimal(0),
  fatG: new Decimal(0),
  carbohydratesG: new Decimal(0),
});
const add = (left: Nutrients, right: Nutrients): Nutrients => ({
  caloriesKcal: left.caloriesKcal.plus(right.caloriesKcal),
  proteinG: left.proteinG.plus(right.proteinG),
  fatG: left.fatG.plus(right.fatG),
  carbohydratesG: left.carbohydratesG.plus(right.carbohydratesG),
});
const multiply = (value: Nutrients, factor: Decimal): Nutrients => ({
  caloriesKcal: value.caloriesKcal.mul(factor),
  proteinG: value.proteinG.mul(factor),
  fatG: value.fatG.mul(factor),
  carbohydratesG: value.carbohydratesG.mul(factor),
});
const divide = (value: Nutrients, divisor: number): Nutrients => ({
  caloriesKcal: value.caloriesKcal.div(divisor),
  proteinG: value.proteinG.div(divisor),
  fatG: value.fatG.div(divisor),
  carbohydratesG: value.carbohydratesG.div(divisor),
});

export function calculateRecipeNutrition(
  input: Readonly<{
    ingredients: readonly NutritionIngredient[];
    profiles: readonly NutritionProfile[];
    servings: number;
  }>,
) {
  if (!Number.isSafeInteger(input.servings) || input.servings <= 0)
    throw new RangeError("servings must be a positive integer");
  const profiles = new Map(
    input.profiles.map((profile) => [profile.ingredientId, profile]),
  );
  const missing: Array<{
    ingredientId: string;
    reason: MissingNutritionReason;
  }> = [];
  let total = zero();
  let knownIngredients = 0;
  for (const ingredient of input.ingredients) {
    const profile = profiles.get(ingredient.ingredientId);
    if (!profile) {
      missing.push({
        ingredientId: ingredient.ingredientId,
        reason: "MISSING_PROFILE",
      });
      continue;
    }
    try {
      const basisUnits = convertQuantity({
        quantity: ingredient.quantity,
        fromUnit: ingredient.unit,
        toUnit: profile.basisUnit,
      }).div(parseDecimal(profile.basisQuantity));
      total = add(
        total,
        multiply(
          {
            caloriesKcal: parseDecimal(profile.caloriesKcal),
            proteinG: parseDecimal(profile.proteinG),
            fatG: parseDecimal(profile.fatG),
            carbohydratesG: parseDecimal(profile.carbohydratesG),
          },
          basisUnits,
        ),
      );
      knownIngredients += 1;
    } catch (error) {
      if (!(error instanceof UnitConversionError)) throw error;
      missing.push({
        ingredientId: ingredient.ingredientId,
        reason: error.code,
      });
    }
  }
  return {
    total,
    perServing: divide(total, input.servings),
    coverage: {
      knownIngredients,
      totalIngredients: input.ingredients.length,
      complete: missing.length === 0,
    },
    missingIngredientIds: [
      ...new Set(missing.map((item) => item.ingredientId)),
    ],
    missing,
  };
}
