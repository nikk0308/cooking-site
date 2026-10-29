"use client";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { CatalogIngredientInput } from "@/modules/catalog/input";
import { createSlug } from "@/modules/recipes/slug";
type Option = { id: string; name: string };
const subscribe = () => () => {};
export function useCatalogReady() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
export async function catalogSend(
  url: string,
  value: unknown,
  method = "POST",
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error([data.error, ...(data.fields ?? [])].join("\n"));
  return data;
}
export function CatalogIngredientForm({
  initial,
  units,
  categories,
}: {
  initial?: CatalogIngredientInput;
  units: Option[];
  categories: Option[];
}) {
  const ready = useCatalogReady(),
    router = useRouter();
  const [v, setV] = useState<CatalogIngredientInput>(
    initial ?? {
      name: "",
      slug: "",
      categoryId: null,
      aliases: [],
      nutrition: null,
    },
  );
  const [aliases, setAliases] = useState((initial?.aliases ?? []).join("\n"));
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [savedNutrition, setSavedNutrition] = useState(!!initial?.nutrition);
  const labels = {
    basisQuantity: "Базовое количество",
    caloriesKcal: "Калории, ккал",
    proteinG: "Белки, г",
    fatG: "Жиры, г",
    carbohydratesG: "Углеводы, г",
  };
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        try {
          const result = await catalogSend("/api/admin/ingredients", {
            ...v,
            aliases: aliases
              .split("\n")
              .map((a) => a.trim())
              .filter(Boolean),
          });
          setMessage("Сохранено");
          if (!initial?.id) {
            setV({
              name: "",
              slug: "",
              categoryId: null,
              aliases: [],
              nutrition: null,
            });
            setAliases("");
            setSavedNutrition(false);
          } else {
            setV({
              ...v,
              id: result.id,
              expected: result.expected,
              removeNutrition: false,
            });
            setSavedNutrition(!!v.nutrition);
          }
          router.refresh();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={!ready || busy}>
        <legend>
          {initial ? "Редактирование ингредиента" : "Новый ингредиент"}
        </legend>
        <div className="form-grid">
          <label>
            Название ингредиента
            <input
              required
              maxLength={256}
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </label>
          <label>
            Slug ингредиента
            <input
              required
              maxLength={256}
              value={v.slug}
              aria-label="Slug ингредиента"
              onChange={(e) => setV({ ...v, slug: e.target.value })}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                try {
                  setV({ ...v, slug: createSlug(v.name) });
                } catch {
                  setMessage("Введите название для slug.");
                }
              }}
            >
              Из названия
            </button>
          </label>
          <label>
            Категория
            <select
              aria-label="Категория"
              value={v.categoryId ?? ""}
              onChange={(e) =>
                setV({ ...v, categoryId: e.target.value || null })
              }
            >
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Синонимы — по одному на строку
          <textarea
            rows={4}
            maxLength={5140}
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={!!v.nutrition}
            onChange={(e) => {
              if (
                !e.target.checked &&
                v.nutrition &&
                savedNutrition &&
                !window.confirm("Удалить сохранённые КБЖУ и их источник?")
              )
                return;
              setV({
                ...v,
                removeNutrition: !e.target.checked && savedNutrition,
                nutrition: e.target.checked
                  ? {
                      basisQuantity: "",
                      basisUnitId: "",
                      caloriesKcal: "",
                      proteinG: "",
                      fatG: "",
                      carbohydratesG: "",
                      sourceKind: "UNKNOWN",
                      sourceNote: "",
                      sourceUrl: null,
                      sourceIdentifier: null,
                    }
                  : null,
              });
            }}
          />{" "}
          Данные КБЖУ известны
        </label>
        {!v.nutrition && (
          <p>
            Пищевая ценность неизвестна. Отсутствующие значения не считаются
            нулями.
          </p>
        )}
        {v.nutrition && (
          <div className="form-grid">
            <label>
              Базовая единица
              <select
                aria-label="Базовая единица"
                required
                value={v.nutrition.basisUnitId}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: { ...v.nutrition!, basisUnitId: e.target.value },
                  })
                }
              >
                <option value="">Выберите единицу</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
              <label key={key}>
                {labels[key]}
                <input
                  required
                  inputMode="decimal"
                  maxLength={19}
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
            <label>
              Тип источника
              <select
                aria-label="Тип источника"
                value={v.nutrition.sourceKind ?? "UNKNOWN"}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: {
                      ...v.nutrition!,
                      sourceKind: e.target.value as
                        "UNKNOWN" | "MANUAL" | "REFERENCE" | "IMPORT",
                    },
                  })
                }
              >
                {["UNKNOWN", "MANUAL", "REFERENCE", "IMPORT"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Источник данных
              <input
                maxLength={1000}
                value={v.nutrition.sourceNote ?? ""}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: { ...v.nutrition!, sourceNote: e.target.value },
                  })
                }
              />
            </label>
            <label>
              URL источника
              <input
                type="url"
                maxLength={2048}
                value={v.nutrition.sourceUrl ?? ""}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: {
                      ...v.nutrition!,
                      sourceUrl: e.target.value || null,
                    },
                  })
                }
              />
            </label>
            <label>
              Идентификатор источника
              <input
                required={v.nutrition.sourceKind === "IMPORT"}
                maxLength={256}
                value={v.nutrition.sourceIdentifier ?? ""}
                onChange={(e) =>
                  setV({
                    ...v,
                    nutrition: {
                      ...v.nutrition!,
                      sourceIdentifier: e.target.value || null,
                    },
                  })
                }
              />
            </label>
          </div>
        )}
        <button>Сохранить ингредиент</button>
      </fieldset>
      <p role="alert" style={{ whiteSpace: "pre-wrap" }}>
        {message}
      </p>
    </form>
  );
}
export function CategoryManager({
  rows,
}: {
  rows: { id: string; name: string; slug: string; count: number }[];
}) {
  const ready = useCatalogReady(),
    router = useRouter();
  const [v, setV] = useState<{ id?: string; name: string; slug: string }>({
      name: "",
      slug: "",
    }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await catalogSend("/api/admin/categories", v);
            setV({ name: "", slug: "" });
            setMessage("Категория сохранена");
            router.refresh();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={!ready || busy}>
          <legend>
            {v.id ? "Редактировать категорию" : "Создать категорию"}
          </legend>
          <label>
            Название категории
            <input
              required
              maxLength={256}
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </label>
          <label>
            Slug категории
            <input
              required
              maxLength={256}
              value={v.slug}
              onChange={(e) => setV({ ...v, slug: e.target.value })}
            />
          </label>
          {v.id && (
            <p>Смена slug выполняется явно и не меняет UUID категории.</p>
          )}
          <button>Сохранить категорию</button>
          <button
            type="button"
            className="secondary"
            onClick={() => setV({ name: "", slug: "" })}
          >
            Отменить редактирование
          </button>
        </fieldset>
      </form>
      <p role="alert">{message}</p>
      <ul>
        {rows.map((c) => (
          <li key={c.id}>
            {c.name} ({c.slug}) — ингредиентов: {c.count}{" "}
            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => setV({ id: c.id, name: c.name, slug: c.slug })}
            >
              Редактировать {c.name}
            </button>{" "}
            <button
              type="button"
              className="secondary"
              disabled={!ready || busy || c.count > 0}
              onClick={async () => {
                if (
                  !window.confirm(
                    `Удалить неиспользуемую категорию «${c.name}»?`,
                  )
                )
                  return;
                setBusy(true);
                try {
                  await catalogSend(
                    "/api/admin/categories",
                    { id: c.id },
                    "DELETE",
                  );
                  setMessage("Категория удалена");
                  router.refresh();
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Удалить {c.name}
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 200 && (
        <p>Показаны первые 200 категорий. Уточните поиск.</p>
      )}
    </>
  );
}
