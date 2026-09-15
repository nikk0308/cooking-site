import Decimal from "decimal.js";
import type { UnitDefinition } from "./unit";

export function formatQuantity(
  quantity: Decimal,
  unit: UnitDefinition,
): string {
  return `${quantity.toFixed()} ${unit.symbol}`;
}
