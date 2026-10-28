import { z } from "zod";
import { recipeKey, recipeReference, uuid } from "@/modules/recipes/reference";
import {
  productReference,
  quantity,
  unitDocument,
} from "@/modules/recipes/document";
export const emptyShopping = () => ({
  schemaVersion: 2 as const,
  id: "20000000-0000-4000-8000-000000000001",
  recipes: [],
  manual: [],
  overrides: [],
});
export const shoppingDocument = z
  .object({
    schemaVersion: z.literal(2),
    id: uuid,
    recipes: z
      .array(
        z
          .object({
            id: uuid,
            reference: recipeReference,
            selectedServings: z.number().int().min(1).max(1000),
            addedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(100),
    manual: z
      .array(
        z
          .object({
            id: uuid,
            product: productReference,
            name: z.string().trim().min(1).max(256),
            quantity,
            unit: unitDocument,
          })
          .strict(),
      )
      .max(500),
    overrides: z
      .array(
        z
          .object({
            id: z.string().min(1).max(512),
            purchased: z.boolean(),
            quantity: quantity.nullable(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const list of [v.recipes, v.manual, v.overrides])
      if (new Set(list.map((x) => x.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "Duplicate row identity" });
    if (
      new Set(v.recipes.map((x) => recipeKey(x.reference))).size !==
      v.recipes.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate recipe reference" });
  });
export type ShoppingDocument = z.infer<typeof shoppingDocument>;
