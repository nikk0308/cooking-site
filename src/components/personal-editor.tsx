"use client";
import Link from "next/link";
import { CatalogPicker } from "./catalog-picker";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { BlobImage, NutritionSummary } from "./personal-recipes";
import {
  localRecipeDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
import { standardUnits } from "@/modules/units/unit";
import { PhotoError, validateImage } from "@/platform/browser/images";
import type { PhotoInput } from "@/platform/browser/repository";
import { BrowserStorageError } from "@/platform/browser/database";
type Line = RecipeDocument["ingredients"][number];
function blank(): RecipeDocument {
  return {
    schemaVersion: 1,
    reference: { kind: "LOCAL", id: crypto.randomUUID() },
    title: "",
    description: "",
    slug: null,
    baseServings: 4,
    ingredients: [],
    steps: [],
    photos: [],
  };
}
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let restoring = false;
    let allowedTraversal = false;
    const ask = () =>
      confirm("Есть несохранённые изменения. Уйти без сохранения?");
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        link.target === "_blank" ||
        link.download ||
        e.button ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        link.href === location.href ||
        (link.hash && link.pathname === location.pathname)
      )
        return;
      if (!ask()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Navigation API runs before popstate/router updates can detach this editor.
    // Older browsers retain the popstate and beforeunload fallbacks.
    const navigation = (window as unknown as { navigation?: EventTarget })
      .navigation;
    const navigate = (event: Event) => {
      if (
        (event as Event & { navigationType: string }).navigationType !==
          "traverse" ||
        !event.cancelable
      )
        return;
      if (!ask()) event.preventDefault();
      else allowedTraversal = true;
    };
    const back = (e: PopStateEvent) => {
      if (allowedTraversal) {
        allowedTraversal = false;
        return;
      }
      if (restoring) {
        restoring = false;
        return;
      }
      if (!ask()) {
        e.stopImmediatePropagation();
        restoring = true;
        history.forward();
      }
    };
    navigation?.addEventListener("navigate", navigate);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back, true);
    return () => {
      navigation?.removeEventListener("navigate", navigate);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", back, true);
    };
  }, [dirty]);
}
export function PersonalRecipeEditor({ id }: { id?: string }) {
  const { repo, error: storageError, notify } = useBrowserData(),
    router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDocument | null>(null),
    [assets, setAssets] = useState<PhotoInput[]>([]),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const original = useRef<RecipeDocument | undefined>(undefined);
  useUnsavedChanges(dirty);
  useEffect(() => {
    let active = true;
    if (repo)
      (async () => {
        const r = id ? await repo.get(id) : blank();
        if (!r) throw new Error("Recipe missing");
        const loaded = [];
        for (const p of r.photos) {
          const blob = await repo.getPhoto(r.reference.id, p.id);
          if (!blob) throw new BrowserStorageError("CORRUPTED");
          loaded.push({ id: p.id, blob });
        }
        if (active) {
          original.current = id ? r : undefined;
          setRecipe(r);
          setAssets(loaded);
        }
      })().catch((e) => {
        if (active)
          setError(
            id
              ? `Не удалось открыть рецепт и все фотографии. ${browserError(e)}`
              : browserError(e),
          );
      });
    return () => {
      active = false;
    };
  }, [repo, id]);
  const change = (next: RecipeDocument) => {
    setRecipe(next);
    setDirty(true);
    setError("");
  };
  const line = (index: number, update: Partial<Line>) => {
    if (recipe)
      change({
        ...recipe,
        ingredients: recipe.ingredients.map((x, i) =>
          i === index ? { ...x, ...update } : x,
        ),
      });
  };
  const reorder = <T,>(rows: T[], index: number, step: number) => {
    const next = [...rows];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    return next;
  };
  if (!recipe)
    return (
      <>
        <h1>{id ? "Редактировать личный рецепт" : "Создать личный рецепт"}</h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          !storageError && <p aria-live="polite">Загрузка редактора…</p>
        )}
        <Link href="/my-recipes">Мои рецепты</Link>
      </>
    );
  return (
    <>
      <h1>{id ? "Редактировать личный рецепт" : "Создать личный рецепт"}</h1>
      <p className="muted">
        Сохраняется только в этом браузере.{" "}
        {dirty ? "Есть несохранённые изменения." : "Изменений нет."}
      </p>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!repo) return;
          const parsed = localRecipeDocument.safeParse(recipe);
          if (!parsed.success) {
            setError(
              "Проверьте поля: название обязательно; порции — целое число от 1 до 1000; ингредиентам нужны названия и положительные десятичные количества; шагам — текст.",
            );
            return;
          }
          setBusy(true);
          setError("");
          try {
            await repo.save(parsed.data, assets, original.current);
            setDirty(false);
            notify();
            router.push(`/my-recipes/${parsed.data.reference.id}?saved=1`);
          } catch (err) {
            setError(browserError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <legend>Основное</legend>
          <label>
            Название
            <input
              required
              maxLength={256}
              value={recipe.title}
              onChange={(e) => change({ ...recipe, title: e.target.value })}
            />
          </label>
          <label>
            Описание
            <textarea
              maxLength={10000}
              value={recipe.description}
              onChange={(e) =>
                change({ ...recipe, description: e.target.value })
              }
            />
          </label>
          <label>
            Количество порций
            <input
              type="number"
              min={1}
              max={1000}
              value={recipe.baseServings}
              onChange={(e) =>
                change({ ...recipe, baseServings: Number(e.target.value) })
              }
            />
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Ингредиенты</legend>
          {recipe.ingredients.map((x, i) => {
            const options = [
              ...Object.values(standardUnits),
              {
                code: "custom",
                name: "произвольная единица",
                symbol: "по вкусу",
                dimension: "CUSTOM" as const,
                factorToBase: null,
              },
            ];
            if (
              !options.some((u) => JSON.stringify(u) === JSON.stringify(x.unit))
            )
              options.push(x.unit as (typeof options)[number]);
            return (
              <section
                className="panel"
                key={x.id}
                aria-label={`Ингредиент ${i + 1}`}
              >
                <div className="form-grid">
                  <label>
                    Ингредиент {i + 1}
                    <input
                      maxLength={256}
                      value={x.name}
                      readOnly={x.product.kind === "CATALOG"}
                      onChange={(e) => line(i, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    Количество {i + 1}
                    <input
                      inputMode="decimal"
                      value={x.quantity}
                      onChange={(e) =>
                        line(i, { quantity: e.target.value.replace(",", ".") })
                      }
                    />
                  </label>
                  <label>
                    Единица {i + 1}
                    <select
                      value={JSON.stringify(x.unit)}
                      onChange={(e) =>
                        line(i, { unit: JSON.parse(e.target.value) })
                      }
                    >
                      {options.map((u) => (
                        <option
                          key={JSON.stringify(u)}
                          value={JSON.stringify(u)}
                        >
                          {u.name} ({u.symbol})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Группа {i + 1}
                    <input
                      maxLength={128}
                      value={x.group ?? ""}
                      onChange={(e) =>
                        line(i, { group: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    Примечание {i + 1}
                    <input
                      maxLength={1000}
                      value={x.note}
                      onChange={(e) => line(i, { note: e.target.value })}
                    />
                  </label>
                </div>
                <p className="muted">
                  {x.product.kind === "CATALOG"
                    ? "Продукт общего каталога. Чтобы редактировать название независимо от каталога, сделайте продукт личным; прежнее КБЖУ будет сброшено."
                    : "Переименование сохраняет личный продукт и его КБЖУ. Для другого продукта нажмите «Заменить другим продуктом»: он получит новую идентичность без прежнего КБЖУ. Названия не используются для объединения."}
                </p>
                <button
                  type="button"
                  className="secondary"
                  aria-label={
                    x.product.kind === "CATALOG"
                      ? `Сделать ингредиент ${i + 1} личным`
                      : `Заменить продукт ингредиента ${i + 1}`
                  }
                  onClick={() =>
                    line(i, {
                      name: x.product.kind === "CATALOG" ? x.name : "",
                      product: { kind: "LOCAL", id: crypto.randomUUID() },
                      nutrition: null,
                    })
                  }
                >
                  {x.product.kind === "CATALOG"
                    ? "Сделать личным продуктом"
                    : "Заменить другим продуктом"}
                </button>
                <CatalogPicker
                  select={(r) =>
                    line(i, {
                      name: r.name,
                      product: { kind: "CATALOG", id: r.id },
                      nutrition: r.nutrition,
                    })
                  }
                />
                <div className="actions">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() =>
                      change({
                        ...recipe,
                        ingredients: reorder(recipe.ingredients, i, -1),
                      })
                    }
                  >
                    Ингредиент {i + 1} вверх
                  </button>
                  <button
                    type="button"
                    disabled={i === recipe.ingredients.length - 1}
                    onClick={() =>
                      change({
                        ...recipe,
                        ingredients: reorder(recipe.ingredients, i, 1),
                      })
                    }
                  >
                    Ингредиент {i + 1} вниз
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      change({
                        ...recipe,
                        ingredients: recipe.ingredients.filter(
                          (_, j) => j !== i,
                        ),
                      })
                    }
                  >
                    Удалить ингредиент {i + 1}
                  </button>
                </div>
              </section>
            );
          })}
          <button
            type="button"
            disabled={recipe.ingredients.length >= 100}
            onClick={() =>
              change({
                ...recipe,
                ingredients: [
                  ...recipe.ingredients,
                  {
                    id: crypto.randomUUID(),
                    product: { kind: "LOCAL", id: crypto.randomUUID() },
                    name: "",
                    quantity: "1",
                    unit: standardUnits.g,
                    group: null,
                    note: "",
                    nutrition: null,
                  },
                ],
              })
            }
          >
            Добавить ингредиент
          </button>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Приготовление</legend>
          {recipe.steps.map((s, i) => (
            <section key={s.id}>
              <label>
                Шаг {i + 1}
                <textarea
                  value={s.instruction}
                  maxLength={10000}
                  onChange={(e) =>
                    change({
                      ...recipe,
                      steps: recipe.steps.map((x, j) =>
                        j === i ? { ...x, instruction: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  disabled={!i}
                  onClick={() =>
                    change({ ...recipe, steps: reorder(recipe.steps, i, -1) })
                  }
                >
                  Шаг {i + 1} вверх
                </button>
                <button
                  type="button"
                  disabled={i === recipe.steps.length - 1}
                  onClick={() =>
                    change({ ...recipe, steps: reorder(recipe.steps, i, 1) })
                  }
                >
                  Шаг {i + 1} вниз
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    change({
                      ...recipe,
                      steps: recipe.steps.filter((_, j) => i !== j),
                    })
                  }
                >
                  Удалить шаг {i + 1}
                </button>
              </div>
            </section>
          ))}
          <button
            type="button"
            disabled={recipe.steps.length >= 100}
            onClick={() =>
              change({
                ...recipe,
                steps: [
                  ...recipe.steps,
                  { id: crypto.randomUUID(), instruction: "" },
                ],
              })
            }
          >
            Добавить шаг
          </button>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Фотографии</legend>
          <p>
            JPEG, PNG, WebP: до 10 фото, каждое до 10 МиБ и 16 мегапикселей.
            Анимация не поддерживается.
          </p>
          <label>
            Добавить фотографии
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={recipe.photos.length >= 10}
              onChange={async (e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                if (files.length) setDirty(true);
                e.currentTarget.value = "";
                setBusy(true);
                setError("");
                try {
                  if (files.length + recipe.photos.length > 10)
                    throw new PhotoError(
                      "В одном рецепте можно сохранить не больше 10 фотографий.",
                    );
                  const added = [];
                  for (const file of files)
                    added.push({
                      id: crypto.randomUUID(),
                      blob: await validateImage(file),
                    });
                  setAssets([...assets, ...added]);
                  change({
                    ...recipe,
                    photos: [
                      ...recipe.photos,
                      ...added.map((a, i) => ({
                        kind: "LOCAL" as const,
                        id: a.id,
                        alt: `Фото ${recipe.photos.length + i + 1}`,
                      })),
                    ],
                  });
                } catch (err) {
                  setError(browserError(err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <div className="photo-grid">
            {recipe.photos.map((p, i) => (
              <section key={p.id}>
                <BlobImage
                  blob={assets.find((a) => a.id === p.id)?.blob ?? null}
                  alt={p.alt || recipe.title || "Фото рецепта"}
                />
                <label>
                  Описание фото {i + 1}
                  <input
                    value={p.alt}
                    maxLength={512}
                    onChange={(e) =>
                      change({
                        ...recipe,
                        photos: recipe.photos.map((a, j) =>
                          j === i ? { ...a, alt: e.target.value } : a,
                        ),
                      })
                    }
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    disabled={!i}
                    onClick={() =>
                      change({
                        ...recipe,
                        photos: reorder(recipe.photos, i, -1),
                      })
                    }
                  >
                    Фото {i + 1} вверх
                  </button>
                  <button
                    type="button"
                    disabled={i === recipe.photos.length - 1}
                    onClick={() =>
                      change({
                        ...recipe,
                        photos: reorder(recipe.photos, i, 1),
                      })
                    }
                  >
                    Фото {i + 1} вниз
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setAssets(assets.filter((a) => a.id !== p.id));
                      change({
                        ...recipe,
                        photos: recipe.photos.filter((a) => a.id !== p.id),
                      });
                    }}
                  >
                    Удалить фото {i + 1}
                  </button>
                </div>
              </section>
            ))}
          </div>
        </fieldset>
        <h2>Предпросмотр КБЖУ на порцию</h2>
        <NutritionSummary recipe={recipe} full />
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Сохранить личный рецепт
          </button>
          <Link className="button secondary" href="/my-recipes">
            Отмена
          </Link>
        </div>
      </form>
    </>
  );
}
