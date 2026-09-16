"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useMemo } from "react";
import {
  basketKey,
  parseBasket,
  type BasketDocument,
} from "@/modules/basket/document";
import type { resolveBasket } from "@/modules/basket/service";
import { Servings } from "@/components/recipe-controls";
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("basket-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("basket-change", listener);
  };
};
const snapshot = () => {
  try {
    return localStorage.getItem(basketKey) ?? "";
  } catch {
    return "invalid";
  }
};
export default function BasketPage() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const parsed = useMemo(() => {
    try {
      return { doc: parseBasket(raw), error: "" };
    } catch {
      return {
        doc: null,
        error:
          "Список повреждён или имеет неизвестную версию. Очистите его, чтобы начать заново.",
      };
    }
  }, [raw]);
  const [state, setState] = useState<{
      raw: string | null;
      result?: Awaited<ReturnType<typeof resolveBasket>>;
      error?: string;
    } | null>(null),
    [storageError, setStorageError] = useState("");
  useEffect(() => {
    if (raw === null || !parsed.doc) return;
    const controller = new AbortController();
    fetch("/api/basket/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.doc),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const result = await r.json();
        if (!controller.signal.aborted) setState({ raw, result });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            raw,
            error: "Не удалось обновить список. Повторите попытку.",
          });
      });
    return () => controller.abort();
  }, [raw, parsed]);
  function update(next: BasketDocument) {
    try {
      localStorage.setItem(basketKey, JSON.stringify(next));
      window.dispatchEvent(new Event("basket-change"));
      setStorageError("");
    } catch {
      setStorageError("Браузер не разрешает сохранить список.");
    }
  }
  const error = storageError || parsed.error || state?.error,
    doc = parsed.doc;
  const result = state?.raw === raw ? state.result : undefined;
  return (
    <main>
      <h1>Список продуктов</h1>
      <p>Ингредиенты выбранных рецептов с учётом порций.</p>
      <button
        className="secondary"
        onClick={() => update({ schemaVersion: 1, items: [] })}
      >
        Очистить список
      </button>
      {error && <p role="alert">{error}</p>}
      {!result && !error ? (
        <p role="status">Обновляем список…</p>
      ) : (
        result && (
          <>
            {!result.items.length ? (
              <p className="panel">
                Список пуст. <Link href="/">Выберите рецепт</Link>.
              </p>
            ) : (
              <>
                <h2>Выбранные рецепты</h2>
                {result.items.map((item) => (
                  <div className="panel" key={item.recipeId}>
                    {item.slug ? (
                      <Link href={"/recipes/" + item.slug}>{item.title}</Link>
                    ) : (
                      <strong>Рецепт недоступен</strong>
                    )}
                    <Servings
                      value={item.selectedServings}
                      onChange={(value) =>
                        update({
                          ...doc!,
                          items: doc!.items.map((i) =>
                            i.recipeId === item.recipeId
                              ? { ...i, selectedServings: value }
                              : i,
                          ),
                        })
                      }
                    />
                    <button
                      className="secondary"
                      onClick={() =>
                        update({
                          ...doc!,
                          items: doc!.items.filter(
                            (i) => i.recipeId !== item.recipeId,
                          ),
                        })
                      }
                    >
                      Удалить {item.title}
                    </button>
                  </div>
                ))}
                <h2>Продукты</h2>
                <ul className="ingredients">
                  {result.ingredients.map((i, index) => (
                    <li key={index}>
                      <span>
                        {i.name}
                        {i.incompatible && (
                          <small> · разные единицы, учтены отдельно</small>
                        )}
                      </span>
                      <strong>{i.quantity}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )
      )}
    </main>
  );
}
