"use client";
import { useEffect, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import { legacyPlan, type LegacyPreview } from "@/modules/shopping/legacy";
import { basketKey } from "@/modules/basket/document";
import { ShoppingError } from "@/modules/shopping/operations";
import { resolveReferences } from "@/platform/browser/resolve-recipes";

export function LegacyShopping({
  pending,
}: {
  pending: (value: boolean) => void;
}) {
  const { repo, revision, notify } = useBrowserData();
  const [preview, setPreview] = useState<LegacyPreview | null>(null),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [titles, setTitles] = useState<Record<string, string>>({}),
    [choices, setChoices] = useState<Record<string, "V1" | "V2">>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === basketKey || event.key === null) {
        setChoices({});
        setMessage("");
        setRefresh((v) => v + 1);
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    let active = true;
    if (repo)
      repo
        .legacyPreview()
        .then(async (p) => {
          const plan = legacyPlan(p);
          const needed =
            (!!p.receipt && (p.receipt.raw !== p.raw || !p.receipt.verified)) ||
            (!p.receipt && plan.rows.length > 0);
          if (active) {
            setPreview(p);
            setLoadError("");
            pending(needed);
          }
          if (needed) {
            const rows = await resolveReferences(
              repo,
              plan.rows.map((r) => ({ kind: "PUBLIC", id: r.recipeId })),
            );
            if (active)
              setTitles(
                Object.fromEntries(
                  rows.map((r) => [
                    r.reference.id,
                    r.recipe?.title ??
                      (r.availability === "UNRESOLVED"
                        ? "Временно не удалось загрузить название"
                        : "Рецепт недоступен"),
                  ]),
                ),
              );
          }
        })
        .catch((e) => {
          if (active) {
            setPreview(null);
            setLoadError(
              e instanceof ShoppingError ? e.message : browserError(e),
            );
            pending(true);
          }
        });
    return () => {
      active = false;
    };
  }, [repo, revision, refresh, pending]);
  let plan: ReturnType<typeof legacyPlan> | undefined;
  if (preview) plan = legacyPlan(preview, choices);
  const needed =
    !!preview &&
    ((!!preview.receipt &&
      (preview.receipt.raw !== preview.raw || !preview.receipt.verified)) ||
      (!preview.receipt && !!plan?.rows.length));
  return (
    <section aria-label="Перенос старой корзины">
      {loadError && (
        <p role="alert">
          Старую корзину не удалось прочитать. {loadError} v1 не изменена. Это
          не означает, что старая корзина пуста.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {needed && preview && plan && (
        <div className="panel">
          <h2>
            {preview.receipt?.raw !== preview.raw && preview.receipt
              ? "Старая корзина изменилась — требуется согласование"
              : preview.receipt
                ? "Проверка переноса не завершена"
                : "Найдена старая корзина v1"}
          </h2>
          <p>
            Перенос только после подтверждения. Исходные байты v1 сохраняются.
            Личные рецепты, ручные продукты, отметки и количества v2 не
            заменяются автоматически. v1 не входит в переносимый backup, пока её
            позиции не перенесены в v2.
          </p>
          <ul>
            {plan.rows.map((r) => (
              <li key={r.recipeId}>
                {titles[r.recipeId] ?? "Публичный рецепт"}{" "}
                <code>{r.recipeId}</code>: v1 — {r.selectedServings} порций;{" "}
                {r.added
                  ? "будет добавлен PUBLIC"
                  : r.existing === undefined
                    ? "в v2 отсутствует; удаление сохраняется без явного выбора v1"
                    : `v2 — ${r.existing} порций`}
                {r.conflict &&
                  (preview.receipt ? (
                    <label>
                      Порции для {r.recipeId}
                      <select
                        value={choices[r.recipeId] ?? ""}
                        onChange={(e) =>
                          setChoices({
                            ...choices,
                            [r.recipeId]: e.target.value as "V1" | "V2",
                          })
                        }
                      >
                        <option value="">Выберите явно</option>
                        <option value="V2">Оставить v2: {r.existing}</option>
                        <option value="V1">
                          Взять v1: {r.selectedServings}
                        </option>
                      </select>
                    </label>
                  ) : (
                    <strong>
                      {" "}
                      · сохранятся порции v2; изменить их можно после переноса
                    </strong>
                  ))}
              </li>
            ))}
          </ul>
          {!!plan.removed.length && (
            <p>
              Удалены из v1: {plan.removed.length}. Их позиции v2 сохранятся;
              удалите их явно, если нужно.
            </p>
          )}
          {preview.raw === null ? (
            <p>
              Источник v1 удалён другой вкладкой. Данные v2 и предыдущая копия
              v1 сохранены; переносить нечего.
            </p>
          ) : (
            <button
              disabled={busy || plan.conflicts.length > 0}
              onClick={async () => {
                if (
                  !repo ||
                  !confirm(
                    "Подтвердить показанный перенос/согласование? Исходная v1 останется без изменений.",
                  )
                )
                  return;
                setBusy(true);
                setError("");
                setMessage("");
                try {
                  let result;
                  if (
                    preview.receipt &&
                    (preview.receipt.raw !== preview.raw ||
                      !preview.receipt.verified)
                  ) {
                    await repo.reconcileLegacy(preview, choices);
                    result = await repo.migrateBasket();
                  } else {
                    const actual = await repo.legacyPreview();
                    if (
                      actual.raw !== preview.raw ||
                      actual.revision !== preview.revision
                    )
                      throw new Error("Stale preview");
                    result = await repo.migrateBasket(localStorage, {
                      raw: preview.raw!,
                      revision: preview.revision,
                    });
                  }
                  setMessage(
                    result === "LEGACY_CHANGED"
                      ? "v1 снова изменилась. Сохранён перенесённый снимок; проверьте новый предпросмотр."
                      : result === "NO_SOURCE"
                        ? "Источник v1 исчез во время операции. Проверка не завершена; текущая v2 и сохранённый снимок источника не очищены."
                        : "Перенос проверен. Данные v2 сохранены; оригинал v1 не удалён.",
                  );
                  setChoices({});
                  notify();
                  setRefresh((v) => v + 1);
                } catch (e) {
                  setError(
                    `${browserError(e)} Повторите предпросмотр. Обе версии сохранены.`,
                  );
                  notify();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Подтвердить перенос v1
            </button>
          )}
        </div>
      )}
      {(error || loadError) && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            setChoices({});
            setMessage("");
            setRefresh((v) => v + 1);
          }}
        >
          Повторить предпросмотр v1
        </button>
      )}
    </section>
  );
}
