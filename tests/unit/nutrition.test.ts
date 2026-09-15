import { describe, expect, it } from "vitest";
import {
  calculateRecipeNutrition,
  type NutritionProfile,
} from "@/modules/nutrition/calculation";
import { scaleRecipeIngredients } from "@/modules/recipes/scaling";
import { standardUnits } from "@/modules/units/unit";

const profiles: NutritionProfile[] = [
  {
    ingredientId: "flour",
    basisQuantity: "100",
    basisUnit: standardUnits.g,
    caloriesKcal: "364",
    proteinG: "10",
    fatG: "1",
    carbohydratesG: "76",
  },
  {
    ingredientId: "milk",
    basisQuantity: "100",
    basisUnit: standardUnits.ml,
    caloriesKcal: "52",
    proteinG: "2.8",
    fatG: "2.5",
    carbohydratesG: "4.7",
  },
  {
    ingredientId: "egg",
    basisQuantity: "1",
    basisUnit: standardUnits.pcs,
    caloriesKcal: "70",
    proteinG: "6",
    fatG: "5",
    carbohydratesG: "0.4",
  },
];

describe("nutrition calculation", () => {
  it("calculates mass, volume and count profiles", () => {
    const result = calculateRecipeNutrition({
      ingredients: [
        { ingredientId: "flour", quantity: "0.5", unit: standardUnits.kg },
        { ingredientId: "milk", quantity: "200", unit: standardUnits.ml },
        { ingredientId: "egg", quantity: "2", unit: standardUnits.pcs },
      ],
      profiles,
      servings: 4,
    });
    expect(result.total.caloriesKcal.toFixed()).toBe("2064");
    expect(result.perServing.caloriesKcal.toFixed()).toBe("516");
    expect(result.coverage).toEqual({
      knownIngredients: 3,
      totalIngredients: 3,
      complete: true,
    });
  });

  it("reports missing and incompatible contributions instead of treating them as zero", () => {
    const result = calculateRecipeNutrition({
      ingredients: [
        { ingredientId: "flour", quantity: "100", unit: standardUnits.ml },
        { ingredientId: "unknown", quantity: "1", unit: standardUnits.pcs },
        { ingredientId: "egg", quantity: "1", unit: standardUnits.pcs },
      ],
      profiles,
      servings: 1,
    });
    expect(result.total.caloriesKcal.toFixed()).toBe("70");
    expect(result.coverage).toEqual({
      knownIngredients: 1,
      totalIngredients: 3,
      complete: false,
    });
    expect(result.missing).toEqual(
      expect.arrayContaining([
        { ingredientId: "flour", reason: "INCOMPATIBLE_DIMENSION" },
        { ingredientId: "unknown", reason: "MISSING_PROFILE" },
      ]),
    );
  });

  it("keeps per-serving nutrition invariant under linear scaling", () => {
    const base = [{ ingredientId: "flour", quantity: "500", unitCode: "g" }];
    const baseResult = calculateRecipeNutrition({
      ingredients: [
        { ingredientId: "flour", quantity: "500", unit: standardUnits.g },
      ],
      profiles,
      servings: 4,
    });
    const scaled = scaleRecipeIngredients(base, 4, 6);
    const scaledResult = calculateRecipeNutrition({
      ingredients: scaled.map((item) => ({
        ingredientId: item.ingredientId,
        quantity: item.quantity.toFixed(),
        unit: standardUnits.g,
      })),
      profiles,
      servings: 6,
    });
    expect(
      scaledResult.total.caloriesKcal.equals(
        baseResult.total.caloriesKcal.mul("1.5"),
      ),
    ).toBe(true);
    expect(
      scaledResult.perServing.caloriesKcal.equals(
        baseResult.perServing.caloriesKcal,
      ),
    ).toBe(true);
  });
});
