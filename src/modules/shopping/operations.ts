import { shoppingDocument, type ShoppingDocument } from "./document";
import { resolveShopping } from "./calculation";
import {
  recipeKey,
  recipeReference,
  type RecipeReference,
} from "@/modules/recipes/reference";
import type { RecipeDocument } from "@/modules/recipes/document";

export class ShoppingError extends Error {}
export function upsertRecipe(
  doc: ShoppingDocument,
  raw: RecipeReference,
  servings: number,
) {
  const ref = recipeReference.parse(raw),
    existing = doc.recipes.find(
      (r) => recipeKey(r.reference) === recipeKey(ref),
    );
  if (!existing && doc.recipes.length >= 100)
    throw new ShoppingError(
      "В списке уже 100 рецептов. Удалите ненужную ссылку перед добавлением новой.",
    );
  return shoppingDocument.parse({
    ...doc,
    recipes: existing
      ? doc.recipes.map((r) =>
          r.id === existing.id ? { ...r, selectedServings: servings } : r,
        )
      : [
          ...doc.recipes,
          {
            id: crypto.randomUUID(),
            reference: ref,
            selectedServings: servings,
            addedAt: new Date().toISOString(),
          },
        ],
  });
}
// Explicit source edits retire overrides only when the corresponding bucket is gone
// or its CUSTOM unit changed. Incomplete removals require a visible warning/checkpoint.
export function pruneOverrides(
  before: ShoppingDocument,
  next: ShoppingDocument,
  available: RecipeDocument[],
) {
  const previous = resolveShopping(before, available).items,
    remaining = resolveShopping(next, available).items;
  return shoppingDocument.parse({
    ...next,
    overrides: next.overrides.filter((o) => {
      const row = remaining.find((i) => i.id === o.id),
        old = previous.find((i) => i.id === o.id);
      return (
        row && (!old || JSON.stringify(row.unit) === JSON.stringify(old.unit))
      );
    }),
  });
}
export function editBucket(
  doc: ShoppingDocument,
  id: string,
  edit: { purchased?: boolean; quantity?: string | null },
) {
  const existing = doc.overrides.find((o) => o.id === id);
  const current = existing ?? {
    id,
    purchased: false,
    quantity: null,
  };
  const next = { ...current, ...edit };
  if (
    !existing &&
    (next.purchased || next.quantity !== null) &&
    doc.overrides.length >= 1000
  )
    throw new ShoppingError(
      "Достигнут лимит 1000 настроенных позиций. Снимите лишние отметки или сбросьте ручные количества.",
    );
  return shoppingDocument.parse({
    ...doc,
    overrides: [
      ...doc.overrides.filter((o) => o.id !== id),
      ...(!next.purchased && next.quantity === null ? [] : [next]),
    ],
  });
}
