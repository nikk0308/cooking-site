import { z } from "zod";
import Decimal from "decimal.js";
const decimal = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Число: до 12 целых и 6 дробных знаков");
const positive = decimal.refine(
  (v) => new Decimal(v).gt(0),
  "Количество должно быть больше нуля",
);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте латиницу, цифры и дефис");
export const recipeInput = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(1, "Введите название").max(256),
    slug,
    description: z.string().trim().max(10000).default(""),
    baseServings: z.number().int().min(1).max(1000),
    prepTimeMinutes: z.number().int().min(0).max(10080).nullable(),
    cookTimeMinutes: z.number().int().min(0).max(10080).nullable(),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
    coverMediaId: z.uuid().nullable().default(null),
    ingredients: z
      .array(
        z.object({
          ingredientId: z.uuid(),
          quantity: positive,
          unitId: z.uuid(),
          groupLabel: z.string().trim().max(128).default(""),
          note: z.string().trim().max(1000).default(""),
        }),
      )
      .max(100),
    steps: z
      .array(z.string().trim().min(1, "Введите текст шага").max(10000))
      .max(100),
  })
  .superRefine((v, ctx) => {
    if (v.status === "PUBLISHED") {
      if (!v.ingredients.length)
        ctx.addIssue({
          code: "custom",
          path: ["ingredients"],
          message: "Для публикации нужен ингредиент",
        });
      if (!v.steps.length)
        ctx.addIssue({
          code: "custom",
          path: ["steps"],
          message: "Для публикации нужен шаг",
        });
    }
  });
export type RecipeInput = z.infer<typeof recipeInput>;
export const ingredientInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(256),
  slug,
  nutrition: z
    .object({
      basisQuantity: positive,
      basisUnitId: z.uuid(),
      caloriesKcal: decimal,
      proteinG: decimal,
      fatG: decimal,
      carbohydratesG: decimal,
      sourceNote: z.string().trim().max(1000),
    })
    .nullable(),
});
