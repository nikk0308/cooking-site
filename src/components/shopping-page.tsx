"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { Servings } from "./recipe-controls";
import { ManualProductForm, type ManualProduct } from "./shopping-manual";
import { LegacyShopping } from "./shopping-legacy";
import { resolveReferences } from "@/platform/browser/resolve-recipes";
import { resolveShopping } from "@/modules/shopping/calculation";
import {
  editBucket,
  pruneOverrides,
  ShoppingError,
} from "@/modules/shopping/operations";
import type { ShoppingDocument } from "@/modules/shopping/document";
import { quantity } from "@/modules/recipes/document";
import { recipeKey } from "@/modules/recipes/reference";
import { displayQuantity } from "@/modules/recipes/presentation";
import { Decimal } from "@/shared/decimal/decimal";
import type { openBrowserRepository } from "@/platform/browser/repository";

type Repo = Awaited<ReturnType<typeof openBrowserRepository>>;
type View = Awaited<ReturnType<Repo["shopping"]["view"]>> & {
  rows: Awaited<ReturnType<typeof resolveReferences>>;
};
type Bucket = ReturnType<typeof resolveShopping>["items"][number];
function PersistedServings({
  value,
  save,
}: {
  value: number;
  save: (value: number) => Promise<void>;
}) {
  const [pending, setPending] = useState<number | null>(null),
    sequence = useRef(0);
  return (
    <Servings
      value={pending ?? value}
      onChange={async (next) => {
        const request = ++sequence.current;
        setPending(next);
        try {
          await save(next);
        } catch {
          /* The list shows persistence errors. */
        } finally {
          if (request === sequence.current) setPending(null);
        }
      }}
    />
  );
}
function PurchasedCheck({
  item,
  disabled,
  save,
}: {
  item: Bucket;
  disabled: boolean;
  save: (value: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <label>
      <input
        type="checkbox"
        disabled={disabled || pending !== null}
        checked={pending ?? item.purchased}
        onChange={async (e) => {
          const value = e.target.checked;
          setPending(value);
          try {
            await save(value);
          } catch {
            /* Stored value remains authoritative; the list shows the error. */
          } finally {
            setPending(null);
          }
        }}
      />{" "}
      Куплено: {item.name}
    </label>
  );
}
function QuantityEdit({
  item,
  save,
  disabled,
}: {
  item: Bucket;
  save: (value: string | null) => Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null),
    [error, setError] = useState("");
  const value = draft ?? item.quantity;
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!quantity.safeParse(value).success) {
          setError("Нужно положительное десятичное количество.");
          return;
        }
        try {
          await save(value);
          setDraft(null);
          setError("");
        } catch {
          setError(
            "Количество не сохранено. Повторите после обновления списка.",
          );
        }
      }}
    >
      <label>
        Новое количество для {item.name} ({item.unit.symbol})
        <input
          inputMode="decimal"
          disabled={disabled}
          value={value}
          onChange={(e) => setDraft(e.target.value.replace(",", "."))}
        />
      </label>
      <div className="actions">
        <button disabled={disabled}>Изменить количество</button>
        <button
          type="button"
          className="secondary"
          disabled={disabled || !item.overridden}
          onClick={() => {
            void save(null)
              .then(() => {
                setDraft(null);
                setError("");
              })
              .catch(() => setError("Не удалось сбросить количество."));
          }}
        >
          Вернуть расчётное количество
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function ShoppingPage() {
  const { repo, revision, notify, error: storageError } = useBrowserData();
  const [view, setView] = useState<View | null>(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [message, setMessage] = useState(""),
    [pendingBusy, setBusy] = useState(false),
    [hidePurchased, setHidePurchased] = useState(false),
    [editing, setEditing] = useState<ManualProduct | null>(null),
    [legacyPending, setLegacyPending] = useState(true);
  const pendingOperations = useRef(0);
  const busy = pendingBusy || !!loadError;
  useEffect(() => {
    let active = true;
    if (repo)
      (async () => {
        const state = await repo.shopping.view();
        const rows = await resolveReferences(
          repo,
          state.document.recipes.map((r) => r.reference),
        );
        if (active) {
          setView({ ...state, rows });
          setLoadError("");
        }
      })().catch((e) => {
        if (active) {
          setLoadError(browserError(e));
        }
      });
    return () => {
      active = false;
    };
  }, [repo, revision]);
  const available =
      view?.rows.flatMap((r) => (r.recipe ? [r.recipe] : [])) ?? [],
    result = view ? resolveShopping(view.document, available) : null;
  const incomplete = !!result?.unavailable.length;
  const activeIds = new Set(result?.items.map((item) => item.id));
  const unmatchedOverrides =
    view?.document.overrides.filter((o) => !activeIds.has(o.id)) ?? [];
  async function run(action: () => Promise<unknown>, text: string) {
    if (!repo) return;
    pendingOperations.current++;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      const latest = await repo.shopping.view();
      setView((current) => (current ? { ...current, ...latest } : null));
      setMessage(text);
      notify();
    } catch (e) {
      setError(e instanceof ShoppingError ? e.message : browserError(e));
      notify();
      throw e;
    } finally {
      pendingOperations.current--;
      setBusy(pendingOperations.current > 0);
    }
  }
  function remove(change: (d: ShoppingDocument) => ShoppingDocument) {
    if (!repo || !view) return;
    if (
      incomplete &&
      !confirm(
        "Часть рецептов недоступна. Удалить источник и снять настройки строк, которых больше нет среди известных продуктов? Контрольная копия позволит отменить, пока список не изменён.",
      )
    )
      return;
    void run(
      () =>
        repo.shopping.checkpointUpdate(
          (d) => pruneOverrides(d, change(d), available),
          view.revision,
        ),
      "Источник удалён. Осиротевшие настройки сняты; доступна отмена.",
    ).catch(() => {});
  }
  function bucket(
    id: string,
    edit: { purchased?: boolean; quantity?: string | null },
  ) {
    return run(
      () =>
        repo!.shopping.update((d) => {
          if (!resolveShopping(d, available).items.some((i) => i.id === id))
            throw new ShoppingError(
              "Позиция уже изменилась. Обновите список; ничего не перезаписано.",
            );
          return editBucket(d, id, edit);
        }),
      "Позиция сохранена",
    );
  }
  const checkpointReady =
    view?.checkpoint &&
    JSON.stringify(view.document) === JSON.stringify(view.checkpoint.after);
  return (
    <>
      <h1>Список продуктов</h1>
      <p>
        Общий список публичных и личных рецептов. Данные сохраняются только в
        этом браузере; перенос на другое устройство — через backup на странице
        «Мои рецепты».
      </p>
      <LegacyShopping pending={setLegacyPending} />
      <button
        type="button"
        className="secondary"
        {...{ autoComplete: "off" }}
        disabled={!repo || pendingBusy}
        onClick={() => {
          setError("");
          setLoadError("");
          notify();
        }}
      >
        Обновить список
      </button>
      {error && <p role="alert">{error}</p>}
      {loadError && (
        <p role="alert">
          {loadError}{" "}
          {view &&
            "Показано последнее загруженное состояние; оно может устареть. Черновик оставлен в форме. Повторите доступ; перед перезагрузкой сохраните текст правок отдельно."}
        </p>
      )}
      {!view && !storageError && !error && !loadError && (
        <p role="status">Загрузка списка…</p>
      )}
      {view && result && (
        <>
          {incomplete && (
            <p className="storage-notice" role="alert">
              Неполный список: {result.unavailable.length} рецептов не удалось
              разрешить. Показаны только известные продукты; итог не является
              полным. Настройки агрегированных строк временно недоступны.
            </p>
          )}
          <p aria-live="polite">
            Позиций: {result.items.length}; куплено:{" "}
            {result.items.filter((i) => i.purchased).length}; осталось:{" "}
            {result.items.filter((i) => !i.purchased).length}.
            {incomplete && " Только известная часть."}
          </p>
          {!view.document.recipes.length &&
            !view.document.manual.length &&
            !legacyPending && (
              <p className="panel">
                Список пуст. <Link href="/">Выберите рецепт</Link> или добавьте
                продукт вручную.
              </p>
            )}
          <h2>Выбранные рецепты</h2>
          {view.document.recipes.map((item) => {
            const row = view.rows.find(
                (r) => recipeKey(r.reference) === recipeKey(item.reference),
              ),
              recipe = row?.recipe;
            const title =
              recipe?.title ??
              (!row || row.availability === "UNRESOLVED"
                ? "Временно не удалось загрузить рецепт"
                : "Рецепт недоступен");
            return (
              <section
                className="panel"
                key={item.id}
                data-reference={recipeKey(item.reference)}
                aria-label={`Рецепт ${title}`}
              >
                <p>
                  {item.reference.kind === "PUBLIC"
                    ? "PUBLIC · публичный"
                    : "LOCAL · личный"}
                </p>
                {recipe ? (
                  <Link
                    href={
                      recipe.reference.kind === "PUBLIC"
                        ? `/recipes/${recipe.slug}`
                        : `/my-recipes/${recipe.reference.id}`
                    }
                  >
                    {title}
                  </Link>
                ) : (
                  <>
                    <strong>{title}</strong>
                    <p>
                      {item.reference.id}. Ссылка сохранена до явного удаления.
                    </p>
                  </>
                )}
                <fieldset disabled={!!loadError}>
                  <legend className="sr-only">Порции рецепта {title}</legend>
                  <PersistedServings
                    value={item.selectedServings}
                    save={async (servings) => {
                      await run(
                        () =>
                          repo!.shopping.update((d) => {
                            if (!d.recipes.some((r) => r.id === item.id))
                              throw new ShoppingError(
                                "Рецепт уже удалён из списка.",
                              );
                            return {
                              ...d,
                              recipes: d.recipes.map((r) =>
                                r.id === item.id
                                  ? { ...r, selectedServings: servings }
                                  : r,
                              ),
                            };
                          }),
                        "Порции сохранены",
                      );
                    }}
                  />
                </fieldset>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(
                        () =>
                          repo!.shopping.update((d) => {
                            const rows = [...d.recipes],
                              at = rows.findIndex((r) => r.id === item.id);
                            if (at > 0)
                              [rows[at - 1], rows[at]] = [
                                rows[at],
                                rows[at - 1],
                              ];
                            return { ...d, recipes: rows };
                          }),
                        "Порядок сохранён",
                      ).catch(() => {});
                    }}
                  >
                    Поднять {title}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      remove((d) => ({
                        ...d,
                        recipes: d.recipes.filter((r) => r.id !== item.id),
                      }))
                    }
                  >
                    Удалить {title}
                  </button>
                </div>
              </section>
            );
          })}
          <h2>Добавить вручную</h2>
          {view.document.manual.length >= 500 && (
            <p>
              Достигнут лимит 500 ручных продуктов. Удалите ненужный продукт
              перед добавлением нового.
            </p>
          )}
          <ManualProductForm
            disabled={busy || view.document.manual.length >= 500}
            save={async (row) => {
              await run(
                () =>
                  repo!.shopping.update((d) => ({
                    ...d,
                    manual: [...d.manual, row],
                  })),
                "Продукт добавлен",
              );
            }}
          />
          {!!view.document.manual.length && (
            <section>
              <h2>Ручные продукты</h2>
              {view.document.manual.map((row) => (
                <div className="panel" key={row.id} data-manual-id={row.id}>
                  {editing?.id === row.id ? (
                    <ManualProductForm
                      disabled={busy}
                      key={row.id}
                      initial={editing}
                      cancel={() => setEditing(null)}
                      save={async (next) => {
                        if (
                          incomplete &&
                          !confirm(
                            "Рецепты разрешены не полностью. Сохранить правки и снять осиротевшие настройки? Доступна отмена, пока список не изменён.",
                          )
                        )
                          throw new ShoppingError("Правки не применены.");
                        await run(
                          () =>
                            repo!.shopping.checkpointUpdate((d) => {
                              const actual = d.manual.find(
                                (i) => i.id === row.id,
                              );
                              if (
                                JSON.stringify(actual) !==
                                JSON.stringify(editing)
                              )
                                throw new ShoppingError(
                                  "Ручной продукт изменился в другой вкладке. Скопируйте правки и откройте его заново.",
                                );
                              return pruneOverrides(
                                d,
                                {
                                  ...d,
                                  manual: d.manual.map((i) =>
                                    i.id === row.id ? next : i,
                                  ),
                                },
                                available,
                              );
                            }, view.revision),
                          "Продукт сохранён",
                        );
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <>
                      <strong>{row.name}</strong>
                      <p>
                        {row.quantity} {row.unit.symbol} · {row.product.kind}
                      </p>
                      <div className="actions">
                        <button disabled={busy} onClick={() => setEditing(row)}>
                          Редактировать {row.name}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            remove((d) => ({
                              ...d,
                              manual: d.manual.filter((i) => i.id !== row.id),
                            }))
                          }
                        >
                          Удалить ручной {row.name}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </section>
          )}
          <h2>Продукты</h2>
          <label className="shopping-filter">
            <input
              type="checkbox"
              checked={hidePurchased}
              onChange={(e) => setHidePurchased(e.target.checked)}
            />{" "}
            Скрыть купленные
          </label>
          <ul className="shopping-items">
            {result.items
              .filter((i) => !hidePurchased || !i.purchased)
              .map((item) => (
                <li className="panel" key={item.id} data-shopping-id={item.id}>
                  <PurchasedCheck
                    item={item}
                    disabled={busy || incomplete}
                    save={(purchased) => bucket(item.id, { purchased })}
                  />
                  <strong>
                    {displayQuantity(new Decimal(item.quantity), item.unit)}
                  </strong>
                  <p>
                    Расчётное количество: {item.calculatedQuantity}{" "}
                    {item.unit.symbol}
                    {view.document.overrides.some(
                      (o) => o.id === item.id && o.quantity !== null,
                    ) && " · изменено вручную"}
                  </p>
                  {item.incompatible && (
                    <p>Разные размерности — учтены отдельно, без плотности.</p>
                  )}
                  <details>
                    <summary>Изменить количество: {item.name}</summary>
                    <QuantityEdit
                      key={item.id}
                      item={item}
                      disabled={busy || incomplete}
                      save={(value) => bucket(item.id, { quantity: value })}
                    />
                  </details>
                </li>
              ))}
          </ul>
          {!!unmatchedOverrides.length && (
            <details className="panel shopping-orphans">
              <summary>
                Сохранённые неприменённые настройки: {unmatchedOverrides.length}
              </summary>
              <p>
                Источник недоступен, позиция исчезла или изменился формат
                CUSTOM-ключа/единица. Эти настройки сохранены, но не применяются
                автоматически к другой строке. Проверьте значения и при
                необходимости задайте их вручную подходящему продукту. Перед
                удалением источников сохраните backup, если эти настройки нужны.
              </p>
              <ul>
                {unmatchedOverrides.map((o) => (
                  <li key={o.id}>
                    <code>{o.id}</code>:{" "}
                    {o.purchased ? "куплено" : "не куплено"};{" "}
                    {o.quantity === null
                      ? "без ручного количества"
                      : `ручное количество: ${o.quantity}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <section className="panel">
            <h2>Очистка и восстановление</h2>
            <p>
              Очистка затрагивает только shopping v2. Рецепты, фото, избранное и
              v1 остаются. Отмена доступна после перезагрузки, пока список не
              изменён. Следующая операция с контрольной копией заменяет
              предыдущую.
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm("Снять все отметки куплено? Количества сохранятся.")
                  )
                    void run(
                      () =>
                        repo!.shopping.update((d) => ({
                          ...d,
                          overrides: d.overrides
                            .map((o) => ({ ...o, purchased: false }))
                            .filter((o) => o.quantity !== null),
                        })),
                      "Отметки сняты",
                    ).catch(() => {});
                }}
              >
                Снять отметки куплено
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Очистить весь список v2, включая ручные продукты и настройки? Будет сохранена контрольная копия для отмены.",
                    )
                  )
                    void run(
                      () =>
                        repo!.shopping.checkpointUpdate(
                          (d) => ({
                            ...d,
                            recipes: [],
                            manual: [],
                            overrides: [],
                          }),
                          view.revision,
                        ),
                      "Список очищен. Можно отменить, пока список не изменён.",
                    ).catch(() => {});
                }}
              >
                Очистить список
              </button>
              <button
                disabled={busy || !checkpointReady}
                onClick={() => {
                  void run(
                    () => repo!.shopping.undo(),
                    "Предыдущее состояние списка восстановлено",
                  ).catch(() => {});
                }}
              >
                Отменить последнее удаление или очистку
              </button>
            </div>
            {view.checkpoint && !checkpointReady && (
              <p>
                Список изменился после контрольной копии. Отмена заблокирована,
                чтобы не перезаписать новые данные.
              </p>
            )}
          </section>
        </>
      )}
      <p role="status">{message}</p>
    </>
  );
}
