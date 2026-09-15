import { describe, expect, it } from "vitest";
import {
  scaleQuantityForServings,
  scaleRecipeIngredients,
} from "@/modules/recipes/scaling";

describe("servings scaling", () => {
  it.each([
    [4, 6, "750"],
    [4, 2, "250"],
  ])("scales base quantity", (baseServings, targetServings, expected) =>
    expect(
      scaleQuantityForServings({
        baseQuantity: "500",
        baseServings,
        targetServings,
      }).toFixed(),
    ).toBe(expected),
  );
  it("allows an exact fractional COUNT result", () => {
    expect(
      scaleQuantityForServings({
        baseQuantity: "1",
        baseServings: 2,
        targetServings: 1,
      }).toFixed(),
    ).toBe("0.5");
  });
  it("always scales from base data without cumulative rounding", () => {
    const base = [
      { ingredientId: "flour", quantity: "0.333333", unitCode: "kg" },
    ];
    const first = scaleRecipeIngredients(base, 3, 7)[0].quantity;
    const second = scaleRecipeIngredients(base, 3, 7)[0].quantity;
    expect(first.equals(second)).toBe(true);
    expect(first.toFixed()).toBe("0.777777");
  });
  it("rejects non-positive or fractional servings", () => {
    expect(() =>
      scaleQuantityForServings({
        baseQuantity: "1",
        baseServings: 0,
        targetServings: 1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      scaleQuantityForServings({
        baseQuantity: "1",
        baseServings: 2,
        targetServings: 1.5,
      }),
    ).toThrow(RangeError);
  });
});
