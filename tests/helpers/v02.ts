import { type RecipeDocument } from "@/modules/recipes/document";
import { standardUnits } from "@/modules/units/unit";
export const recipeId = "30000000-0000-4000-8000-000000000001";
export const productId = "40000000-0000-4000-8000-000000000001";
export function localRecipe(id = recipeId): RecipeDocument {
  return {
    schemaVersion: 1,
    reference: { kind: "LOCAL", id },
    title: "Personal recipe",
    description: "Private",
    slug: null,
    baseServings: 4,
    ingredients: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        product: { kind: "CATALOG", id: productId },
        name: "Творог",
        quantity: "500",
        unit: standardUnits.g,
        group: "Основа",
        note: "",
        nutrition: null,
      },
    ],
    steps: [{ id: "60000000-0000-4000-8000-000000000001", instruction: "Mix" }],
    photos: [],
  };
}
