import { z } from "zod";
import { recipeRepository } from "./repository";
import { publicRecipeDocument } from "./document";
import { uuid } from "./reference";

export async function resolvePublicDocuments(
  raw: string[],
  repo = recipeRepository(),
) {
  const ids = z.array(uuid).max(100).parse(raw);
  // Data-layer publication guard is retained; admin reads must never be used here.
  return (await repo.resolvePublishedRecipes(ids)).map(publicRecipeDocument);
}
