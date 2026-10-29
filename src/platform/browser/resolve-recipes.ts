import { recipeDocument } from "@/modules/recipes/document";
import type { RecipeReference } from "@/modules/recipes/reference";
import { resolveFavorites } from "@/modules/favorites/document";
import type { openBrowserRepository } from "./repository";

export async function resolveReferences(
  repo: Awaited<ReturnType<typeof openBrowserRepository>>,
  refs: RecipeReference[],
) {
  const ids = refs.filter((r) => r.kind === "PUBLIC").map((r) => r.id),
    documents = new Map<string, ReturnType<typeof recipeDocument.parse>>(),
    failed = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    try {
      const response = await fetch(
        `/api/recipes/resolve?${new URLSearchParams(batch.map((id) => ["id", id]))}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.recipes) || data.recipes.length > 100)
        throw new Error();
      for (const raw of data.recipes) {
        const recipe = recipeDocument.parse(raw);
        if (
          recipe.reference.kind !== "PUBLIC" ||
          !batch.includes(recipe.reference.id)
        )
          throw new Error();
        documents.set(recipe.reference.id, recipe);
      }
    } catch {
      for (const id of batch) failed.add(id);
    }
  }
  return resolveFavorites(refs, async (ref) => {
    if (ref.kind === "LOCAL") return (await repo.get(ref.id)) ?? null;
    if (failed.has(ref.id)) throw new Error("Temporary resolver failure");
    return documents.get(ref.id) ?? null;
  });
}
