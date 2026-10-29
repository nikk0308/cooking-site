"use client";
import { useEffect, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { RecipeCard } from "./personal-recipes";
import { type RecipeDocument } from "@/modules/recipes/document";
import { recipeKey, type RecipeReference } from "@/modules/recipes/reference";
import { resolveReferences } from "@/platform/browser/resolve-recipes";
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
        const refs = (await repo.favorites.list()).items;
        const resolved = await resolveReferences(repo, refs);
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
