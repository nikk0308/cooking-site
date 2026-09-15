import Decimal from "decimal.js";
import { convertQuantity } from "@/modules/units/conversion";
import type { UnitDefinition } from "@/modules/units/unit";

export type BasketQuantity = Readonly<{
  ingredientId: string;
  quantity: string;
  unit: UnitDefinition;
}>;
export type BasketBucket = Readonly<{
  ingredientId: string;
  dimension: UnitDefinition["dimension"];
  quantity: Decimal;
  unit: UnitDefinition;
}>;

export function aggregateBasket(
  input: readonly BasketQuantity[],
  baseUnits: Readonly<
    Partial<Record<UnitDefinition["dimension"], UnitDefinition>>
  >,
) {
  const buckets = new Map<string, BasketBucket>();
  const dimensionsByIngredient = new Map<
    string,
    Set<UnitDefinition["dimension"]>
  >();
  input.forEach((item, index) => {
    const dimensions =
      dimensionsByIngredient.get(item.ingredientId) ?? new Set();
    dimensions.add(item.unit.dimension);
    dimensionsByIngredient.set(item.ingredientId, dimensions);
    const baseUnit = baseUnits[item.unit.dimension];
    if (!baseUnit || item.unit.dimension === "CUSTOM") {
      buckets.set(`${item.ingredientId}:CUSTOM:${index}`, {
        ingredientId: item.ingredientId,
        dimension: item.unit.dimension,
        quantity: new Decimal(item.quantity),
        unit: item.unit,
      });
      return;
    }
    const key = `${item.ingredientId}:${item.unit.dimension}`;
    const quantity = convertQuantity({
      quantity: item.quantity,
      fromUnit: item.unit,
      toUnit: baseUnit,
    });
    const existing = buckets.get(key);
    buckets.set(key, {
      ingredientId: item.ingredientId,
      dimension: item.unit.dimension,
      quantity: existing ? existing.quantity.plus(quantity) : quantity,
      unit: baseUnit,
    });
  });
  return {
    buckets: [...buckets.values()],
    incompatibleIngredientIds: [...dimensionsByIngredient]
      .filter(([, dimensions]) => dimensions.size > 1)
      .map(([ingredientId]) => ingredientId),
  };
}
