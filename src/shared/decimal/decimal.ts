import Decimal from "decimal.js";
export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};
export function parseDecimal(value: string): Decimal {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError("Canonical decimal input must be a non-empty string");
  return new Decimal(value);
}
export function serializeDecimal(value: Decimal): DecimalString {
  return value.toFixed() as DecimalString;
}
