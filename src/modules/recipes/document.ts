import { z } from "zod";
import { Decimal } from "@/shared/decimal/decimal";
import { recipeReference, uuid } from "./reference";
import type { RecipeAggregate } from "./repository";
import type { UnitDefinition } from "@/modules/units/unit";

export const quantity = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,23})(?:\.\d{1,24})?$/)
  .refine((v) => new Decimal(v).gt(0));
const nonnegative = z.string().regex(/^(?:0|[1-9]\d{0,23})(?:\.\d{1,24})?$/);
export const unitDocument = z
  .object({
    code: z.string().min(1).max(32),
    name: z.string().min(1).max(128),
    symbol: z.string().min(1).max(32),
    dimension: z.enum(["MASS", "VOLUME", "COUNT", "CUSTOM"]),
    factorToBase: quantity.nullable(),
  })
  .strict()
  .refine((u) =>
    u.dimension === "CUSTOM"
      ? u.factorToBase === null
      : u.factorToBase !== null,
  );
export const productReference = z
  .object({ kind: z.enum(["CATALOG", "LOCAL"]), id: uuid })
  .strict();
export type ProductReference = z.infer<typeof productReference>;
export const productKey = (p: ProductReference) => `${p.kind}:${p.id}`;
export const nutritionDocument = z
  .object({
    basisQuantity: quantity,
    basisUnit: unitDocument,
    caloriesKcal: nonnegative,
    proteinG: nonnegative,
    fatG: nonnegative,
    carbohydratesG: nonnegative,
    source: z
      .object({
        kind: z.enum(["UNKNOWN", "MANUAL", "REFERENCE", "IMPORT"]),
        note: z.string().max(10000).nullable(),
        url: z
          .url()
          .refine(
            (value) => /^https?:\/\//.test(value),
            "HTTP(S) source URL required",
          )
          .nullable(),
        identifier: z.string().max(256).nullable().default(null),
      })
      .strict(),
  })
  .strict();
const photoReference = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("LOCAL"), id: uuid, alt: z.string().max(512) })
    .strict(),
  z
    .object({
      kind: z.literal("PUBLIC"),
      id: uuid,
      alt: z.string().max(512),
      url: z.string().regex(/^\/media\/[a-f0-9-]+\.webp$/),
    })
    .strict(),
]);
export const recipeDocument = z
  .object({
    schemaVersion: z.literal(1),
    reference: recipeReference,
    title: z.string().trim().min(1).max(256),
    description: z.string().max(10000),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(256)
      .nullable(),
    baseServings: z.number().int().min(1).max(1000),
    ingredients: z
      .array(
        z
          .object({
            id: uuid,
            product: productReference,
            name: z.string().trim().min(1).max(256),
            quantity,
            unit: unitDocument,
            group: z.string().max(128).nullable(),
            note: z.string().max(1000),
            nutrition: nutritionDocument.nullable(),
          })
          .strict(),
      )
      .max(100),
    steps: z
      .array(
        z
          .object({
            id: uuid,
            instruction: z.string().trim().min(1).max(10000),
          })
          .strict(),
      )
      .max(100),
    photos: z.array(photoReference).max(10),
  })
  .strict()
  .superRefine((doc, ctx) => {
    for (const list of [doc.ingredients, doc.steps, doc.photos]) {
      if (new Set(list.map((x) => x.id)).size !== list.length)
        ctx.addIssue({ code: "custom", message: "Duplicate child identity" });
    }
    if (doc.photos.some((p) => p.kind !== doc.reference.kind))
      ctx.addIssue({
        code: "custom",
        message: "Photo origin must match recipe",
      });
    if ((doc.reference.kind === "LOCAL") !== (doc.slug === null))
      ctx.addIssue({
        code: "custom",
        message: "Only public recipes have server slugs",
      });
  });
export const localRecipeDocument = recipeDocument.refine(
  (doc) => doc.reference.kind === "LOCAL",
  "Local recipe required",
);
export type RecipeDocument = z.infer<typeof recipeDocument>;

export function publicRecipeDocument(recipe: RecipeAggregate): RecipeDocument {
  if (recipe.status !== "PUBLISHED") throw new Error("Recipe is not public");
  const unit = ({
    code,
    name,
    symbol,
    dimension,
    factorToBase,
  }: UnitDefinition) => ({ code, name, symbol, dimension, factorToBase });
  return recipeDocument.parse({
    schemaVersion: 1,
    reference: { kind: "PUBLIC", id: recipe.id },
    title: recipe.title,
    description: recipe.description ?? "",
    slug: recipe.slug,
    baseServings: recipe.baseServings,
    ingredients: recipe.ingredients.map((x) => ({
      id: x.line.id,
      product: { kind: "CATALOG", id: x.ingredient.id },
      name: x.ingredient.name,
      quantity: x.line.quantity,
      unit: unit(x.unit),
      group: x.line.groupLabel,
      note: x.line.note ?? "",
      nutrition:
        x.nutrition && x.basisUnit
          ? {
              basisQuantity: x.nutrition.basisQuantity,
              basisUnit: unit(x.basisUnit),
              caloriesKcal: x.nutrition.caloriesKcal,
              proteinG: x.nutrition.proteinG,
              fatG: x.nutrition.fatG,
              carbohydratesG: x.nutrition.carbohydratesG,
              source: {
                kind: x.nutrition.sourceKind,
                note: x.nutrition.sourceNote,
                url: x.nutrition.sourceUrl,
                identifier: x.nutrition.sourceIdentifier,
              },
            }
          : null,
    })),
    steps: recipe.steps.map((s) => ({ id: s.id, instruction: s.instruction })),
    photos: recipe.cover
      ? [
          {
            kind: "PUBLIC",
            id: recipe.cover.id,
            alt: recipe.title,
            url: `/media/${recipe.cover.storageKey}`,
          },
        ]
      : [],
  });
}
