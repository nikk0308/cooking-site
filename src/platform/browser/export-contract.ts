import { z } from "zod";
import { localRecipeDocument } from "@/modules/recipes/document";
import { uuid } from "@/modules/recipes/reference";
import { favoritesDocument } from "@/modules/favorites/document";
import { shoppingDocument } from "@/modules/shopping/document";

// Portable envelope shared by validated browser-only import and export.
export const browserExport = z
  .object({
    application: z.literal("culinote"),
    schemaVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    recipes: z.array(localRecipeDocument).max(500),
    favorites: favoritesDocument,
    shopping: shoppingDocument,
    photos: z
      .array(
        z
          .object({
            schemaVersion: z.literal(1),
            id: uuid,
            recipeId: uuid,
            mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
            encoding: z.literal("base64"),
            data: z
              .string()
              .max(14 * 1024 * 1024)
              .regex(
                /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
              ),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = data.recipes.map((r) => r.reference.id),
      photoIds = data.photos.map((p) => p.id);
    if (
      new Set(ids).size !== ids.length ||
      new Set(photoIds).size !== photoIds.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate export identity" });
    for (const recipe of data.recipes)
      for (const ref of recipe.photos)
        if (
          !data.photos.some(
            (p) => p.id === ref.id && p.recipeId === recipe.reference.id,
          )
        )
          ctx.addIssue({
            code: "custom",
            message: "Missing photo Blob payload",
          });
    for (const photo of data.photos)
      if (
        !data.recipes.some(
          (r) =>
            r.reference.id === photo.recipeId &&
            r.photos.some((p) => p.id === photo.id),
        )
      )
        ctx.addIssue({ code: "custom", message: "Orphan export photo" });
  });
