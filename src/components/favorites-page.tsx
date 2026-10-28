"use client";
import { useEffect, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { RecipeCard } from "./personal-recipes";
import {
  recipeDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
import { recipeKey, type RecipeReference } from "@/modules/recipes/reference";
import { resolveFavorites } from "@/modules/favorites/document";
type Row = {
  reference: RecipeReference;
  availability: "AVAILABLE" | "UNAVAILABLE" | "UNRESOLVED";
  recipe: RecipeDocument | null;
};
export function FavoritesPage() {
  const { repo, revision, notify, error: storageError } = useBrowserData();
  const [rows, setRows] = useState<Row[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (repo)
      (async () => {
        const refs = (await repo.favorites.list()).items,
          ids = refs.filter((r) => r.kind === "PUBLIC").map((r) => r.id),
          publicRecipes = new Map<string, RecipeDocument>(),
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
              const r = recipeDocument.parse(raw);
              if (
                r.reference.kind !== "PUBLIC" ||
                !batch.includes(r.reference.id)
              )
                throw new Error();
              publicRecipes.set(r.reference.id, r);
            }
          } catch {
            for (const id of batch) failed.add(id);
          }
        }
        const resolved = await resolveFavorites(refs, async (ref) => {
          if (ref.kind === "LOCAL") return (await repo.get(ref.id)) ?? null;
          if (failed.has(ref.id)) throw new Error("Temporary resolver failure");
          return publicRecipes.get(ref.id) ?? null;
        });
        if (active) {
          setRows(resolved);
          setError("");
        }
      })().catch((e) => {
        if (active) setError(browserError(e));
      });
    return () => {
      active = false;
    };
  }, [repo, revision]);
  return (
    <>
      <h1>Избранное</h1>
      <p>
        Ссылки на публичные и личные рецепты сохраняются только в этом браузере.
      </p>
      <button className="secondary" disabled={!repo} onClick={notify}>
        Обновить избранное
      </button>
      {error && <p role="alert">{error}</p>}
      {!error &&
        !storageError &&
        (rows === null ? (
          <p aria-live="polite">Загрузка избранного…</p>
        ) : !rows.length ? (
          <p className="panel">В избранном пока нет рецептов.</p>
        ) : (
          <div className="cards">
            {rows.map((row) =>
              row.recipe ? (
                <RecipeCard
                  key={recipeKey(row.reference)}
                  recipe={row.recipe}
                />
              ) : (
                <article
                  className="card card-body"
                  key={recipeKey(row.reference)}
                  data-reference={recipeKey(row.reference)}
                >
                  <h2>
                    {row.availability === "UNRESOLVED"
                      ? "Временно не удалось загрузить рецепт"
                      : row.reference.kind === "LOCAL"
                        ? "Личный рецепт удалён или недоступен"
                        : "Публичный рецепт недоступен"}
                  </h2>
                  <p>
                    {row.reference.kind === "LOCAL" ? "Личный" : "Публичный"} ·{" "}
                    {row.reference.id}
                  </p>
                  <p>
                    {row.availability === "UNRESOLVED"
                      ? "Проверьте подключение и повторите загрузку. Ссылка сохранена."
                      : "Ссылка сохранена; её можно удалить вручную."}
                  </p>
                  <button
                    disabled={!repo}
                    className="secondary"
                    onClick={async () => {
                      if (repo)
                        try {
                          await repo.favorites.remove(row.reference);
                          notify();
                        } catch (e) {
                          setError(browserError(e));
                        }
                    }}
                  >
                    Убрать недоступный рецепт
                  </button>
                </article>
              ),
            )}
          </div>
        ))}
    </>
  );
}
