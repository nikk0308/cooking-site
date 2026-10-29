import { z } from "zod";
import { parseBasket } from "@/modules/basket/document";
import { type ShoppingDocument, shoppingDocument } from "./document";
import { ShoppingError, upsertRecipe } from "./operations";
import { recipeReference } from "@/modules/recipes/reference";

export const legacyReceipt = z
  .object({
    schemaVersion: z.literal(1),
    raw: z.string().max(128 * 1024),
    originalRaw: z
      .string()
      .max(128 * 1024)
      .optional(),
    expected: z.string().max(2 * 1024 * 1024),
    verified: z.boolean(),
  })
  .strict();
export type LegacyReceipt = z.infer<typeof legacyReceipt>;
export type LegacyPreview = {
  raw: string | null;
  receipt: LegacyReceipt | null;
  shopping: ShoppingDocument;
  revision: number;
};
export function legacyPlan(
  preview: LegacyPreview,
  choices: Record<string, "V1" | "V2"> = {},
) {
  choices = z.record(z.string(), z.enum(["V1", "V2"])).parse(choices);
  if ((preview.raw?.length ?? 0) > 128 * 1024)
    throw new ShoppingError(
      "Старая корзина превышает безопасный размер. Источник сохранён.",
    );
  const parse = (raw: string | null) => {
    try {
      return {
        items: parseBasket(raw).items.map((item) => ({
          ...item,
          recipeId: recipeReference.parse({ kind: "PUBLIC", id: item.recipeId })
            .id,
        })),
      };
    } catch {
      throw new ShoppingError(
        "Старая корзина повреждена или имеет неподдерживаемую версию. Не очищайте данные сайта; сохраните исходную v1 для восстановления.",
      );
    }
  };
  const source = parse(preview.raw),
    previous = preview.receipt ? parse(preview.receipt.raw) : { items: [] };
  let next = preview.shopping;
  const rows = source.items.map((item) => {
    const current = next.recipes.find(
      (r) => r.reference.kind === "PUBLIC" && r.reference.id === item.recipeId,
    );
    const old = previous.items.find((r) => r.recipeId === item.recipeId);
    // Initial migration keeps any pre-existing v2 servings. Reconciliation only
    // considers newly added/changed v1 entries, not unchanged old selections.
    const changed = !old || old.selectedServings !== item.selectedServings;
    const conflict =
      changed &&
      ((!!current && current.selectedServings !== item.selectedServings) ||
        (!!old && !current));
    const add =
      !current &&
      (!preview.receipt ||
        !old ||
        (changed && choices[item.recipeId] === "V1"));
    if (add) {
      next = upsertRecipe(
        next,
        { kind: "PUBLIC", id: item.recipeId },
        item.selectedServings,
      );
      next = {
        ...next,
        recipes: next.recipes.map((r) =>
          r.reference.kind === "PUBLIC" && r.reference.id === item.recipeId
            ? { ...r, addedAt: item.addedAt }
            : r,
        ),
      };
    } else if (preview.receipt && conflict && choices[item.recipeId] === "V1")
      next = upsertRecipe(
        next,
        { kind: "PUBLIC", id: item.recipeId },
        item.selectedServings,
      );
    return {
      ...item,
      existing: current?.selectedServings,
      conflict,
      changed,
      added: add,
    };
  });
  return {
    rows,
    removed: previous.items.filter(
      (i) => !source.items.some((r) => r.recipeId === i.recipeId),
    ),
    next: shoppingDocument.parse(next),
    conflicts: preview.receipt
      ? rows.filter((r) => r.conflict && !choices[r.recipeId])
      : [],
  };
}
