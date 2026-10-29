import { z } from "zod";
import { Decimal } from "@/shared/decimal/decimal";
import { normalizeIngredientName } from "./normalization";
export class CatalogError extends Error {}
export const catalogName = z
  .string()
  .trim()
  .min(1, "Введите название")
  .max(256)
  .refine((v) => !v.includes("\0"), "Недопустимый нулевой символ");
export const catalogSlug = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Используйте латиницу, цифры и дефис");
export const catalogNumber = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,6})?$/,
    "До 12 целых и 6 дробных знаков, точка без запятых/экспоненты",
  );
export const positiveCatalogNumber = catalogNumber.refine(
  (v) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && new Decimal(v).gt(0),
  "Количество должно быть положительным",
);
const sourceUrl = z
  .url()
  .max(2048)
  .refine((v) => {
    if (v.includes("\0")) return false;
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Только HTTP(S) URL без credentials")
  .nullable();
const nutritionBase = z
  .object({
    basisQuantity: positiveCatalogNumber,
    basisUnitId: z.uuid(),
    caloriesKcal: catalogNumber,
    proteinG: catalogNumber,
    fatG: catalogNumber,
    carbohydratesG: catalogNumber,
    sourceKind: z.enum(["UNKNOWN", "MANUAL", "REFERENCE", "IMPORT"]).optional(),
    sourceNote: z
      .string()
      .max(1000)
      .refine((v) => !v.includes("\0"))
      .optional(),
    sourceUrl: sourceUrl.optional(),
    sourceIdentifier: z
      .string()
      .max(256)
      .refine((v) => !v.includes("\0"))
      .nullable()
      .optional(),
  })
  .strict();
export const nutritionFields = nutritionBase.superRefine((n, ctx) => {
  if (n.sourceKind === "IMPORT" && !n.sourceIdentifier?.trim())
    ctx.addIssue({
      code: "custom",
      path: ["sourceIdentifier"],
      message: "Для IMPORT нужен идентификатор источника",
    });
});
export const aliasList = z
  .array(catalogName)
  .max(20)
  .superRefine((aliases, ctx) => {
    const keys = aliases.map(normalizeIngredientName);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message: "Синонимы повторяются после нормализации",
      });
  });
export const catalogIngredientInput = z
  .object({
    id: z.uuid().optional(),
    name: catalogName,
    slug: catalogSlug,
    categoryId: z.uuid().nullable().optional(),
    aliases: aliasList.optional(),
    nutrition: nutritionFields.nullable().optional(),
    removeNutrition: z.boolean().optional(),
    expected: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type CatalogIngredientInput = z.infer<typeof catalogIngredientInput>;
export const categoryInput = z
  .object({
    id: z.uuid().optional(),
    name: catalogName,
    slug: catalogSlug,
    expected: z.string().optional(),
  })
  .strict();
export const importNutrition = nutritionBase
  .omit({ basisUnitId: true })
  .extend({
    basisUnit: z.string().min(1).max(32),
    sourceKind: z.enum(["UNKNOWN", "MANUAL", "REFERENCE", "IMPORT"]),
    sourceNote: z
      .string()
      .max(1000)
      .refine((v) => !v.includes("\0")),
    sourceUrl,
    sourceIdentifier: z
      .string()
      .max(256)
      .refine((v) => !v.includes("\0"))
      .nullable(),
  });
export const importRecord = z
  .object({
    externalId: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (v) => v === v.trim() && !v.includes("\0"),
        "externalId должен быть точным ID без краевых пробелов",
      ),
    name: catalogName,
    slug: catalogSlug.optional(),
    category: z
      .object({ name: catalogName, slug: catalogSlug })
      .strict()
      .nullable(),
    aliases: z.array(catalogName).max(40),
    nutrition: importNutrition.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (new Set(r.aliases.map(normalizeIngredientName)).size > 20)
      ctx.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "Максимум 20 уникальных синонимов",
      });
    if (
      r.nutrition?.sourceKind === "IMPORT" &&
      !r.nutrition.sourceIdentifier?.trim()
    )
      ctx.addIssue({
        code: "custom",
        path: ["nutrition", "sourceIdentifier"],
        message: "Для IMPORT нужен идентификатор источника",
      });
  });
export const importEnvelope = z
  .object({
    application: z.literal("culinote-catalog"),
    schemaVersion: z.literal(1),
    namespace: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    batch: z
      .string()
      .max(256)
      .refine((v) => !v.includes("\0"))
      .optional(),
    records: z.array(z.unknown()).min(1).max(500),
  })
  .strict();
export type ImportRecord = z.infer<typeof importRecord>;
const decisionValue = z.union([
  z.enum(["DISTINCT", "KEEP", "REPLACE"]),
  z.object({ link: z.uuid() }).strict(),
]);
export type ImportDecisions = Record<string, z.infer<typeof decisionValue>>;
// Validate entries rather than z.record: reserved JS keys are legitimate opaque
// source IDs and must neither disappear nor invoke a prototype setter.
export const importDecisions = z
  .unknown()
  .transform((raw, ctx): ImportDecisions => {
    if (
      raw === null ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
      Object.keys(raw).length > 500
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Решения должны быть объектом, максимум 500 записей.",
      });
      return z.NEVER;
    }
    const entries = z
      .array(z.tuple([z.string().min(1).max(256), decisionValue]))
      .max(500)
      .safeParse(Object.entries(raw));
    if (!entries.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "Недопустимые решения импорта: DISTINCT / KEEP / REPLACE или link UUID.",
      });
      return z.NEVER;
    }
    return Object.fromEntries(entries.data);
  });
