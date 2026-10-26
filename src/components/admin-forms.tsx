"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createSlug } from "@/modules/recipes/slug";
import type { RecipeInput } from "@/modules/recipes/input";
type Option = { id: string; name: string };
const subscribeHydration = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
}
async function send(url: string, value: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const data = await r.json();
  if (!r.ok) throw new Error([data.error, ...(data.fields ?? [])].join("\n"));
  return data;
}
function suggest(title: string) {
  try {
    return createSlug(title);
  } catch {
    return "";
  }
}
export function LoginForm() {
  const hydrated = useHydrated();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      method="post"
      action="/api/admin/login"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await send("/api/admin/login", {
            email: f.get("email"),
            password: f.get("password"),
          });
          router.push("/admin/recipes");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Email
        <input name="email" type="email" required autoComplete="username" />
      </label>
      <label>
        Пароль
        <input
          name="password"
          type="password"
          required
          maxLength={128}
          autoComplete="current-password"
        />
      </label>
      <button disabled={busy || !hydrated}>{busy ? "Входим…" : "Войти"}</button>
      <p role="alert">{error}</p>
    </form>
  );
}
const emptyRecipe: RecipeInput = {
  title: "",
  slug: "",
  description: "",
  baseServings: 4,
  prepTimeMinutes: 10,
  cookTimeMinutes: 20,
  status: "DRAFT",
  coverMediaId: null,
  ingredients: [],
  steps: [],
};
export function RecipeForm({
  initial,
  ingredients,
  units,
}: {
  initial?: RecipeInput;
  ingredients: Option[];
  units: Option[];
}) {
  const [v, setV] = useState<RecipeInput>(initial ?? emptyRecipe),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [imageMessage, setImageMessage] = useState("");
  const router = useRouter();
  const change = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) =>
    setV((old) => ({ ...old, [key]: value }));
  function move(kind: "ingredients" | "steps", index: number, offset: number) {
    const values = [...v[kind]];
    if (index + offset < 0 || index + offset >= values.length) return;
    [values[index], values[index + offset]] = [
      values[index + offset],
      values[index],
    ];
    setV({ ...v, [kind]: values });
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const data = await send("/api/admin/recipes", v);
          setV({ ...v, id: data.id });
          if (!v.id) router.replace("/admin/recipes/" + data.id);
          else router.refresh();
          setError("Сохранено");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          Название
          <input
            required
            value={v.title}
            onChange={(e) =>
              setV({
                ...v,
                title: e.target.value,
                slug:
                  !v.id && (!v.slug || v.slug === suggest(v.title))
                    ? suggest(e.target.value)
                    : v.slug,
              })
            }
          />
        </label>
        <label>
          Slug
          <input
            aria-label="Slug"
            required
            value={v.slug}
            onChange={(e) => change("slug", e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => change("slug", suggest(v.title))}
          >
            Из названия
          </button>
        </label>
      </div>
      <label>
        Описание
        <textarea
          value={v.description}
          onChange={(e) => change("description", e.target.value)}
        />
      </label>
      <div className="form-grid">
        <label>
          Базовые порции
          <input
            type="number"
            min="1"
            max="1000"
            value={v.baseServings}
            onChange={(e) => change("baseServings", Number(e.target.value))}
          />
        </label>
        <label>
          Статус
          <select
            aria-label="Статус"
            value={v.status}
            onChange={(e) =>
              change("status", e.target.value as RecipeInput["status"])
            }
          >
            <option value="DRAFT">Черновик</option>
            <option value="PUBLISHED">Опубликован</option>
            <option value="ARCHIVED">Архив</option>
          </select>
        </label>
        {(["prepTimeMinutes", "cookTimeMinutes"] as const).map((key, i) => (
          <label key={key}>
            {i ? "Приготовление, мин" : "Подготовка, мин"}
            <input
              type="number"
              min="0"
              value={v[key] ?? ""}
              onChange={(e) =>
                change(
                  key,
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
        ))}
      </div>
      <fieldset>
        <legend>Обложка</legend>
        <label>
          Загрузить фото
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              setImageMessage("");
              try {
                const r = await fetch("/api/admin/media", {
                  method: "POST",
                  body: file,
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                change("coverMediaId", data.id);
                setImageMessage("Фото загружено. Сохраните рецепт.");
              } catch (e) {
                setImageMessage((e as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
        <p role="status">
          {uploading
            ? "Загружаем…"
            : imageMessage ||
              (v.coverMediaId ? "Обложка прикреплена" : "Без обложки")}
        </p>
        {v.coverMediaId && (
          <button
            type="button"
            className="secondary"
            onClick={() => change("coverMediaId", null)}
          >
            Убрать обложку
          </button>
        )}
      </fieldset>
      <h2>Ингредиенты</h2>
      <p>
        <a href="/admin/ingredients" target="_blank" rel="noreferrer">
          Создать или изменить ингредиент
        </a>{" "}
        (после создания обновите форму).
      </p>
      {v.ingredients.map((line, i) => (
        <fieldset key={i}>
          <legend>Ингредиент {i + 1}</legend>
          <div className="form-grid">
            <label>
              Ингредиент
              <select
                aria-label="Ингредиент"
                value={line.ingredientId}
                required
                onChange={(e) =>
                  change(
                    "ingredients",
                    v.ingredients.map((x, j) =>
                      j === i ? { ...x, ingredientId: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="">Выберите</option>
                {ingredients.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Количество
              <input
                required
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) =>
                  change(
                    "ingredients",
                    v.ingredients.map((x, j) =>
                      j === i ? { ...x, quantity: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Единица
              <select
                aria-label="Единица"
                value={line.unitId}
                onChange={(e) =>
                  change(
                    "ingredients",
                    v.ingredients.map((x, j) =>
                      j === i ? { ...x, unitId: e.target.value } : x,
                    ),
                  )
                }
              >
                {units.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Группа
              <input
                value={line.groupLabel}
                onChange={(e) =>
                  change(
                    "ingredients",
                    v.ingredients.map((x, j) =>
                      j === i ? { ...x, groupLabel: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Примечание
              <input
                value={line.note}
                onChange={(e) =>
                  change(
                    "ingredients",
                    v.ingredients.map((x, j) =>
                      j === i ? { ...x, note: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => move("ingredients", i, -1)}
              disabled={i === 0}
            >
              Выше
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => move("ingredients", i, 1)}
              disabled={i === v.ingredients.length - 1}
            >
              Ниже
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change(
                  "ingredients",
                  v.ingredients.filter((_, j) => j !== i),
                )
              }
            >
              Удалить ингредиент
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          change("ingredients", [
            ...v.ingredients,
            {
              ingredientId: "",
              quantity: "1",
              unitId: units[0]?.id ?? "",
              groupLabel: "",
              note: "",
            },
          ])
        }
      >
        Добавить ингредиент
      </button>
      <h2>Шаги</h2>
      {v.steps.map((step, i) => (
        <fieldset key={i}>
          <legend>Шаг {i + 1}</legend>
          <label>
            Инструкция
            <textarea
              required
              value={step}
              onChange={(e) =>
                change(
                  "steps",
                  v.steps.map((s, j) => (j === i ? e.target.value : s)),
                )
              }
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={i === 0}
              onClick={() => move("steps", i, -1)}
            >
              Выше
            </button>
            <button
              type="button"
              className="secondary"
              disabled={i === v.steps.length - 1}
              onClick={() => move("steps", i, 1)}
            >
              Ниже
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                change(
                  "steps",
                  v.steps.filter((_, j) => j !== i),
                )
              }
            >
              Удалить шаг
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => change("steps", [...v.steps, ""])}
      >
        Добавить шаг
      </button>
      <div className="actions">
        <button disabled={busy || uploading}>
          {busy ? "Сохраняем…" : "Сохранить рецепт"}
        </button>
      </div>
      <p role="alert">{error}</p>
    </form>
  );
}
type IngredientValue = {
  id?: string;
  name: string;
  slug: string;
  nutrition: null | {
    basisQuantity: string;
    basisUnitId: string;
    caloriesKcal: string;
    proteinG: string;
    fatG: string;
    carbohydratesG: string;
    sourceNote: string;
  };
};
export function IngredientForm({
  initial,
  units,
}: {
  initial?: IngredientValue;
  units: Option[];
}) {
  const [v, setV] = useState<IngredientValue>(
      initial ?? { name: "", slug: "", nutrition: null },
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  const labels = {
    basisQuantity: "Базовое количество",
    caloriesKcal: "Калории, ккал",
    proteinG: "Белки, г",
    fatG: "Жиры, г",
    carbohydratesG: "Углеводы, г",
    sourceNote: "Источник данных",
  };
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const data = await send("/api/admin/ingredients", v);
          setV({ ...v, id: data.id });
          setError("Сохранено");
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          Название ингредиента
          <input
            aria-label="Название ингредиента"
            required
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Slug ингредиента
          <input
            aria-label="Slug ингредиента"
            required
            value={v.slug}
            onChange={(e) => setV({ ...v, slug: e.target.value })}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setV({ ...v, slug: suggest(v.name) })}
          >
            Из названия
          </button>
        </label>
      </div>
      <label>
        <input
          style={{ width: "auto" }}
          type="checkbox"
          checked={!!v.nutrition}
          onChange={(e) =>
            setV({
              ...v,
              nutrition: e.target.checked
                ? {
                    basisQuantity: "100",
                    basisUnitId: units[0]?.id ?? "",
                    caloriesKcal: "0",
                    proteinG: "0",
                    fatG: "0",
                    carbohydratesG: "0",
                    sourceNote: "",
                  }
                : null,
            })
          }
        />{" "}
        Данные КБЖУ известны
      </label>
      {v.nutrition && (
        <div className="form-grid">
          <label>
            Базовая единица
            <select
              aria-label="Базовая единица"
              value={v.nutrition.basisUnitId}
              onChange={(e) =>
                setV({
                  ...v,
                  nutrition: { ...v.nutrition!, basisUnitId: e.target.value },
                })
              }
            >
              {units.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => (
            <label key={key}>
              {labels[key]}
              <input
                required={key !== "sourceNote"}
                value={v.nutrition![key]}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: { ...v.nutrition!, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      <button disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить ингредиент"}
      </button>
      <p role="alert">{error}</p>
    </form>
  );
}
