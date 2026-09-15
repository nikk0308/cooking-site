import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  UnitConversionError,
} from "@/modules/units/conversion";
import { standardUnits, type UnitDefinition } from "@/modules/units/unit";
import { formatQuantity } from "@/modules/units/format";

const custom: UnitDefinition = {
  code: "bunch",
  name: "пучок",
  symbol: "пучок",
  dimension: "CUSTOM",
  factorToBase: null,
};
const converted = (
  quantity: string,
  fromUnit: UnitDefinition,
  toUnit: UnitDefinition,
) => convertQuantity({ quantity, fromUnit, toUnit }).toFixed();

describe("unit conversion", () => {
  it.each([
    ["1000", standardUnits.g, standardUnits.kg, "1"],
    ["0.5", standardUnits.kg, standardUnits.g, "500"],
    ["1000", standardUnits.ml, standardUnits.l, "1"],
    ["2", standardUnits.tbsp, standardUnits.ml, "30"],
    ["3", standardUnits.tsp, standardUnits.ml, "15"],
    ["5", standardUnits.pcs, standardUnits.pcs, "5"],
  ])("converts %s %s", (quantity, from, to, expected) =>
    expect(converted(quantity, from, to)).toBe(expected),
  );

  it.each([
    [standardUnits.g, standardUnits.ml, "INCOMPATIBLE_DIMENSION"],
    [standardUnits.pcs, standardUnits.g, "INCOMPATIBLE_DIMENSION"],
    [custom, standardUnits.g, "INCOMPATIBLE_DIMENSION"],
    [custom, custom, "NON_CONVERTIBLE_UNIT"],
  ])("rejects unsafe conversions", (fromUnit, toUnit, code) => {
    try {
      convertQuantity({ quantity: "1", fromUnit, toUnit });
      throw new Error("conversion unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(UnitConversionError);
      expect((error as UnitConversionError).code).toBe(code);
    }
  });

  it("formats presentation without changing the canonical value", () => {
    const quantity = convertQuantity({
      quantity: "1.500000",
      fromUnit: standardUnits.l,
      toUnit: standardUnits.l,
    });
    expect(formatQuantity(quantity, standardUnits.l)).toBe("1.5 л");
    expect(quantity.toFixed()).toBe("1.5");
  });
});
