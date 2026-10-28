"use client";
import { useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import type { RecipeReference } from "@/modules/recipes/reference";
import { recipeKey } from "@/modules/recipes/reference";
import { upsertRecipe } from "@/modules/shopping/operations";

export function ShoppingAdd({
  reference,
  servings,
}: {
  reference: RecipeReference;
  servings: number;
}) {
  const { repo, notify } = useBrowserData();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={!repo || busy}
        onClick={async () => {
          if (!repo) return;
          setBusy(true);
          setMessage("");
          let existed = false;
          try {
            await repo.shopping.update((doc) => {
              existed = doc.recipes.some(
                (r) => recipeKey(r.reference) === recipeKey(reference),
              );
              return upsertRecipe(doc, reference, servings);
            });
            notify();
            setMessage(
              existed
                ? "Порции в списке обновлены"
                : "Добавлено в список продуктов",
            );
          } catch (error) {
            setMessage(browserError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        В список продуктов
      </button>
      <p role="status">{message}</p>
    </>
  );
}
