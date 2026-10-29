"use client";
/* eslint-disable @next/next/no-img-element -- browser-owned Blob URLs cannot use server image optimization */
import Link from "next/link";
import { ShoppingAdd } from "./shopping-add";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { FavoriteButton } from "./favorite-button";
import {
  recipeDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
import { recipeKey } from "@/modules/recipes/reference";
import { documentNutrition } from "@/modules/shopping/calculation";
import { scaleQuantityForServings } from "@/modules/recipes/scaling";
import { displayQuantity } from "@/modules/recipes/presentation";
import { Decimal } from "@/shared/decimal/decimal";
import { Servings } from "./recipe-controls";
import { PortabilityPanel } from "./personal-portability";
import { BrowserStorageError } from "@/platform/browser/database";

export function BlobImage({
  blob,
  alt,
  className = "cover",
}: {
  blob: Blob | null;
  alt: string;
  className?: string;
}) {
  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || !blob) return;
      const url = URL.createObjectURL(blob);
      node.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [blob],
  );
  return blob ? (
    <img ref={ref} alt={alt} className={className} loading="lazy" />
  ) : (
    <div
      className="cover placeholder"
      role="img"
      aria-label="Фото рецепта пока нет"
    >
      Фото пока нет
    </div>
  );
}
export function RecipePicture({ recipe }: { recipe: RecipeDocument }) {
  const { repo, revision } = useBrowserData(),
    first = recipe.photos[0];
  const [blob, setBlob] = useState<{ id: string; value: Blob } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (repo && first?.kind === "LOCAL")
      repo
        .getPhoto(recipe.reference.id, first.id)
        .then((b) => {
          if (!b) throw new BrowserStorageError("CORRUPTED");
          if (active) {
            setBlob({ id: first.id, value: b });
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(browserError(e));
        });
    return () => {
      active = false;
    };
  }, [repo, revision, recipe.reference.id, first]);
  if (error && first?.kind === "LOCAL") return <p role="alert">{error}</p>;
  return first?.kind === "PUBLIC" ? (
    <img
      className="cover"
      src={first.url}
      alt={first.alt || recipe.title}
      loading="lazy"
    />
  ) : (
    <BlobImage
      blob={
        first?.kind === "LOCAL" && blob?.id === first.id ? blob.value : null
      }
      alt={first?.alt || recipe.title}
    />
  );
}
export function NutritionSummary({
  recipe,
  full = false,
}: {
  recipe: RecipeDocument;
  full?: boolean;
}) {
  const parsed = recipeDocument.safeParse(recipe);
  if (!parsed.success)
    return (
      <p className="muted">
        Расчёт появится после заполнения корректных полей рецепта.
      </p>
    );
  const result = documentNutrition(parsed.data),
    n = result.perServing;
  if (!recipe.ingredients.length)
    return <p className="muted">Добавьте ингредиенты для расчёта КБЖУ.</p>;
  if (!n)
    return (
      <div className="panel">
        <p>
          КБЖУ рассчитано частично: нет совместимых данных для{" "}
          {result.missing.length} позиций.
        </p>
        {result.coverage.knownIngredients > 0 && (
          <p>
            Известная часть на порцию:{" "}
            {new Decimal(result.knownPerServing.caloriesKcal)
              .toDecimalPlaces(1)
              .toFixed()}{" "}
            ккал. Полный итог неизвестен.
          </p>
        )}
      </div>
    );
  return full ? (
    <div className="nutrition">
      {[
        ["Калории", n.caloriesKcal, "ккал"],
        ["Белки", n.proteinG, "г"],
        ["Жиры", n.fatG, "г"],
        ["Углеводы", n.carbohydratesG, "г"],
      ].map(([name, value, unit]) => (
        <div key={name}>
          {name}
          <strong>
            {new Decimal(value).toDecimalPlaces(1).toFixed()} {unit}
          </strong>
        </div>
      ))}
    </div>
  ) : (
    <p>
      {new Decimal(n.caloriesKcal).toDecimalPlaces(1).toFixed()} ккал на порцию
    </p>
  );
}
export function LocalActions({
  recipe,
  onDeleted,
}: {
  recipe: RecipeDocument;
  onDeleted?: () => void;
}) {
  const { repo, notify } = useBrowserData(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <div className="actions">
        <Link
          className="button secondary"
          href={`/my-recipes/${recipe.reference.id}/edit`}
        >
          Редактировать
        </Link>
        <button
          type="button"
          disabled={!repo || busy}
          onClick={async () => {
            if (!repo) return;
            setBusy(true);
            try {
              const copy = await repo.duplicate(recipe.reference.id);
              notify();
              router.push(`/my-recipes/${copy.reference.id}`);
            } catch (e) {
              setError(browserError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Дублировать
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!repo || busy}
          onClick={async () => {
            if (
              !repo ||
              !confirm(
                `Удалить личный рецепт «${recipe.title}» и его фотографии?`,
              )
            )
              return;
            setBusy(true);
            try {
              await repo.delete(recipe.reference.id);
              notify();
              onDeleted?.();
            } catch (e) {
              setError(browserError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Удалить
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function RecipeCard({
  recipe,
  actions = false,
}: {
  recipe: RecipeDocument;
  actions?: boolean;
}) {
  const local = recipe.reference.kind === "LOCAL",
    href = local
      ? `/my-recipes/${recipe.reference.id}`
      : `/recipes/${recipe.slug}`;
  return (
    <article className="card" data-reference={recipeKey(recipe.reference)}>
      <Link className="card-link" href={href}>
        <RecipePicture recipe={recipe} />
        <div className="card-body">
          <small>{local ? "Личный рецепт" : "Публичный рецепт"}</small>
          <h2>{recipe.title}</h2>
          <p>{recipe.description.slice(0, 180)}</p>
          <p>{recipe.baseServings} порции</p>
          <NutritionSummary recipe={recipe} />
        </div>
      </Link>
      <div className="card-body">
        <FavoriteButton reference={recipe.reference} title={recipe.title} />
        {actions && <LocalActions recipe={recipe} />}
      </div>
    </article>
  );
}
export function PersonalRecipeList() {
  const { repo, error: storageError, revision } = useBrowserData();
  const [recipes, setRecipes] = useState<RecipeDocument[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (repo)
      repo
        .list()
        .then((r) => {
          if (active) {
            setRecipes(r);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(browserError(e));
        });
    return () => {
      active = false;
    };
  }, [repo, revision]);
  return (
    <>
      <h1>Мои рецепты</h1>
      <p>
        Личные рецепты и фотографии хранятся только в этом браузере. Очистка
        данных сайта или удаление профиля может уничтожить их. Регулярно
        экспортируйте backup.
      </p>
      <Link className="button" href="/my-recipes/new">
        Создать рецепт
      </Link>
      {error && <p role="alert">{error}</p>}
      {!error &&
        !storageError &&
        (recipes === null ? (
          <p aria-live="polite">Загрузка личных рецептов…</p>
        ) : recipes.length ? (
          <div className="cards">
            {recipes.map((r) => (
              <RecipeCard key={r.reference.id} recipe={r} actions />
            ))}
          </div>
        ) : (
          <p className="panel">Личных рецептов пока нет.</p>
        ))}
      <PortabilityPanel />
    </>
  );
}
export function PersonalRecipeDetail({ id }: { id: string }) {
  const { repo, revision, error: storageError } = useBrowserData(),
    router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDocument | null | undefined>(null),
    [servings, setServings] = useState(1),
    [photos, setPhotos] = useState<{ id: string; blob: Blob; alt: string }[]>(
      [],
    ),
    [error, setError] = useState("");
  const loaded = useRef("");
  useEffect(() => {
    let active = true;
    if (repo)
      (async () => {
        const r = await repo.get(id),
          assets = [];
        for (const p of r?.photos ?? []) {
          const blob = await repo.getPhoto(id, p.id);
          if (!blob) throw new BrowserStorageError("CORRUPTED");
          assets.push({ id: p.id, blob, alt: p.alt });
        }
        if (active) {
          setRecipe(r);
          if (r && loaded.current !== `${r.reference.id}:${r.baseServings}`) {
            loaded.current = `${r.reference.id}:${r.baseServings}`;
            setServings(r.baseServings);
          }
          setPhotos(assets);
          setError("");
        }
      })().catch((e) => {
        if (active) setError(browserError(e));
      });
    return () => {
      active = false;
    };
  }, [repo, revision, id]);
  if (error) return <p role="alert">{error}</p>;
  if (storageError) return <h1>Личный рецепт</h1>;
  if (recipe === null) return <p aria-live="polite">Загрузка рецепта…</p>;
  if (!recipe)
    return (
      <>
        <h1>Личный рецепт не найден</h1>
        <p>Он удалён или сохранён в другом браузере.</p>
        <Link href="/my-recipes">Мои рецепты</Link>
      </>
    );
  const groups = [...new Set(recipe.ingredients.map((x) => x.group ?? ""))];
  return (
    <>
      <h1>{recipe.title}</h1>
      <p>{recipe.description}</p>
      <FavoriteButton reference={recipe.reference} title={recipe.title} />
      <LocalActions
        recipe={recipe}
        onDeleted={() => router.push("/my-recipes")}
      />
      <div className="photo-grid">
        {photos.map((p) => (
          <BlobImage key={p.id} blob={p.blob} alt={p.alt || recipe.title} />
        ))}
      </div>
      <h2>Ингредиенты</h2>
      <Servings value={servings} onChange={setServings} />
      <ShoppingAdd reference={recipe.reference} servings={servings} />
      {groups.map((g) => (
        <section key={g}>
          {g && <h3>{g}</h3>}
          <ul className="ingredients">
            {recipe.ingredients
              .filter((x) => (x.group ?? "") === g)
              .map((x) => (
                <li key={x.id}>
                  <span>
                    {x.name}
                    {x.note && <small> · {x.note}</small>}
                  </span>
                  <strong>
                    {displayQuantity(
                      scaleQuantityForServings({
                        baseQuantity: x.quantity,
                        baseServings: recipe.baseServings,
                        targetServings: servings,
                      }),
                      x.unit,
                    )}
                  </strong>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <h2>КБЖУ на порцию</h2>
      <NutritionSummary recipe={recipe} full />
      <h2>Приготовление</h2>
      <ol className="steps">
        {recipe.steps.map((s) => (
          <li key={s.id}>{s.instruction}</li>
        ))}
      </ol>
    </>
  );
}
