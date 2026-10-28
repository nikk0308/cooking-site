"use client";
import { useState } from "react";
import { CatalogPicker } from "./catalog-picker";
import {
  shoppingDocument,
  type ShoppingDocument,
} from "@/modules/shopping/document";
import { standardUnits } from "@/modules/units/unit";

export type ManualProduct = ShoppingDocument["manual"][number];
export function ManualProductForm({
  initial,
  save,
  cancel,
  disabled = false,
}: {
  initial?: ManualProduct;
  save: (row: ManualProduct) => Promise<void>;
  cancel?: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<ManualProduct>(
    () =>
      initial ?? {
        id: crypto.randomUUID(),
        product: { kind: "LOCAL", id: crypto.randomUUID() },
        name: "",
        quantity: "1",
        unit: standardUnits.g,
      },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const units = [
    ...Object.values(standardUnits),
    {
      code: "custom",
      name: "произвольная единица",
      symbol: "по вкусу",
      dimension: "CUSTOM" as const,
      factorToBase: null,
    },
  ];
  if (!units.some((u) => JSON.stringify(u) === JSON.stringify(draft.unit)))
    units.push(draft.unit as (typeof units)[number]);
  return (
    <form
      aria-label={
        initial ? `Редактировать ${initial.name}` : "Добавить вручную"
      }
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = shoppingDocument.shape.manual.element.safeParse(draft);
        if (!parsed.success) {
          setError(
            "Укажите название и положительное десятичное количество (до 24 знаков после точки).",
          );
          return;
        }
        setBusy(true);
        setError("");
        try {
          await save(parsed.data);
          if (!initial)
            setDraft({
              id: crypto.randomUUID(),
              product: { kind: "LOCAL", id: crypto.randomUUID() },
              name: "",
              quantity: "1",
              unit: standardUnits.g,
            });
        } catch {
          setError(
            "Не удалось сохранить продукт. Данные могли измениться в другой вкладке или закончилось место. Правки оставлены в форме; проверьте сообщение списка и повторите.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy || disabled}>
        <legend>
          {initial ? "Редактировать ручной продукт" : "Ручной продукт"}
        </legend>
        <div className="form-grid">
          <label>
            Название продукта
            <input
              maxLength={256}
              readOnly={draft.product.kind === "CATALOG"}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Количество продукта
            <input
              inputMode="decimal"
              value={draft.quantity}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  quantity: e.target.value.replace(",", "."),
                })
              }
            />
          </label>
          <label>
            Единица продукта
            <select
              value={JSON.stringify(draft.unit)}
              onChange={(e) =>
                setDraft({ ...draft, unit: JSON.parse(e.target.value) })
              }
            >
              {units.map((u) => (
                <option value={JSON.stringify(u)} key={JSON.stringify(u)}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          {draft.product.kind === "CATALOG"
            ? "Каталожная идентичность сохраняется. Для свободного названия сделайте продукт личным."
            : "Переименование сохраняет идентичность. Другой продукт создавайте явной заменой; совпадение названий не объединяет продукты."}
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            setDraft({
              ...draft,
              name: draft.product.kind === "CATALOG" ? draft.name : "",
              product: { kind: "LOCAL", id: crypto.randomUUID() },
            })
          }
        >
          {draft.product.kind === "CATALOG"
            ? "Сделать личным продуктом"
            : "Заменить другим продуктом"}
        </button>
        <CatalogPicker
          select={(item) =>
            setDraft({
              ...draft,
              name: item.name,
              product: { kind: "CATALOG", id: item.id },
            })
          }
        />
        <div className="actions">
          <button type="submit">
            {initial ? "Сохранить продукт" : "Добавить продукт"}
          </button>
          {cancel && (
            <button type="button" className="secondary" onClick={cancel}>
              Отменить редактирование
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}
