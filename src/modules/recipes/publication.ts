export type RecipeStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export function isPublicRecipeStatus(status: RecipeStatus): boolean {
  return status === "PUBLISHED";
}
