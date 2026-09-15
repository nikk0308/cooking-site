import { describe, expect, it } from "vitest";
import { aggregateBasket } from "@/modules/basket/aggregation";
import { standardUnits } from "@/modules/units/unit";

const bases = {
  MASS: standardUnits.g,
  VOLUME: standardUnits.ml,
  COUNT: standardUnits.pcs,
};

describe("basket aggregation", () => {
  it("aggregates same and convertible units by ingredient identity", () => {
    const result = aggregateBasket(
      [
        { ingredientId: "chicken", quantity: "300", unit: standardUnits.g },
        { ingredientId: "chicken", quantity: "0.5", unit: standardUnits.kg },
        { ingredientId: "egg", quantity: "2", unit: standardUnits.pcs },
        { ingredientId: "egg", quantity: "3", unit: standardUnits.pcs },
      ],
      bases,
    );
    expect(
      result.buckets
        .find((item) => item.ingredientId === "chicken")
        ?.quantity.toFixed(),
    ).toBe("800");
    expect(
      result.buckets
        .find((item) => item.ingredientId === "egg")
        ?.quantity.toFixed(),
    ).toBe("5");
  });

  it("keeps incompatible dimensions separate and reports the ingredient", () => {
    const result = aggregateBasket(
      [
        { ingredientId: "milk", quantity: "200", unit: standardUnits.ml },
        { ingredientId: "milk", quantity: "1", unit: standardUnits.pcs },
      ],
      bases,
    );
    expect(result.buckets).toHaveLength(2);
    expect(result.incompatibleIngredientIds).toEqual(["milk"]);
  });

  it("never merges different ingredient ids", () => {
    const result = aggregateBasket(
      [
        { ingredientId: "egg-a", quantity: "1", unit: standardUnits.pcs },
        { ingredientId: "egg-b", quantity: "1", unit: standardUnits.pcs },
      ],
      bases,
    );
    expect(result.buckets).toHaveLength(2);
  });
});
