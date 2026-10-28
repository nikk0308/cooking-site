import DecimalJS from "decimal.js";
// A private constructor avoids changing third-party/global Decimal settings.
export const Decimal = DecimalJS.clone({ precision: 256 });
export type Decimal = DecimalJS;
export type DecimalString = string & {
  readonly __decimalString: unique symbol;
};
export function parseDecimal(value: string): Decimal {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError("Canonical decimal input must be a non-empty string");
  const parsed = new Decimal(value);
  if (!parsed.isFinite())
    throw new TypeError("Canonical decimal must be finite");
  return parsed;
}
export function serializeDecimal(value: Decimal): DecimalString {
  return value.toFixed() as DecimalString;
}
