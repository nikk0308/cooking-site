import Decimal from "decimal.js";
import { parseDecimal } from "@/shared/decimal/decimal";
import type { UnitDefinition } from "./unit";

export type UnitConversionErrorCode =
  "INCOMPATIBLE_DIMENSION" | "NON_CONVERTIBLE_UNIT";

export class UnitConversionError extends Error {
  constructor(
    public readonly code: UnitConversionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UnitConversionError";
  }
}

export function convertQuantity(
  input: Readonly<{
    quantity: string;
    fromUnit: UnitDefinition;
    toUnit: UnitDefinition;
  }>,
): Decimal {
  const { quantity, fromUnit, toUnit } = input;
  if (fromUnit.dimension !== toUnit.dimension)
    throw new UnitConversionError(
      "INCOMPATIBLE_DIMENSION",
      `${fromUnit.dimension} cannot convert to ${toUnit.dimension}`,
    );
  if (
    fromUnit.dimension === "CUSTOM" ||
    fromUnit.factorToBase === null ||
    toUnit.factorToBase === null
  )
    throw new UnitConversionError(
      "NON_CONVERTIBLE_UNIT",
      "Custom units have no automatic conversion",
    );
  return parseDecimal(quantity)
    .mul(parseDecimal(fromUnit.factorToBase))
    .div(parseDecimal(toUnit.factorToBase));
}
