import { z } from "zod";
export const basketKey = "recipes:basket:v1";
export const basketItem = z
  .object({
    recipeId: z.uuid(),
    selectedServings: z.number().int().min(1).max(1000),
    addedAt: z.iso.datetime(),
    schemaVersion: z.literal(1),
  })
  .strict();
export const basketDocument = z
  .object({ schemaVersion: z.literal(1), items: z.array(basketItem).max(50) })
  .strict()
  .refine(
    (v) => new Set(v.items.map((x) => x.recipeId)).size === v.items.length,
    "Повтор рецепта",
  );
export type BasketDocument = z.infer<typeof basketDocument>;
export function parseBasket(raw: string | null): BasketDocument {
  if (!raw) return { schemaVersion: 1, items: [] };
  return basketDocument.parse(JSON.parse(raw));
}
