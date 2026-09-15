import Decimal from "decimal.js";
import { parseDecimal } from "@/shared/decimal/decimal";

export type BaseRecipeIngredient = Readonly<{
  ingredientId: string;
  quantity: string;
  unitCode: string;
}>;
export type ScaledRecipeIngredient = Omit<BaseRecipeIngredient, "quantity"> &
  Readonly<{ quantity: Decimal }>;

function positiveServings(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be a positive integer`);
}

export function servingsMultiplier(
  baseServings: number,
  targetServings: number,
): Decimal {
  positiveServings(baseServings, "baseServings");
  positiveServings(targetServings, "targetServings");
  return new Decimal(targetServings).div(baseServings);
}

export function scaleQuantityForServings(
  input: Readonly<{
    baseQuantity: string;
    baseServings: number;
    targetServings: number;
  }>,
): Decimal {
  positiveServings(input.baseServings, "baseServings");
  positiveServings(input.targetServings, "targetServings");
  return parseDecimal(input.baseQuantity)
    .mul(input.targetServings)
    .div(input.baseServings);
}

export function scaleRecipeIngredients(
  ingredients: readonly BaseRecipeIngredient[],
  baseServings: number,
  targetServings: number,
): ScaledRecipeIngredient[] {
  positiveServings(baseServings, "baseServings");
  positiveServings(targetServings, "targetServings");
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: parseDecimal(ingredient.quantity)
      .mul(targetServings)
      .div(baseServings),
  }));
}
