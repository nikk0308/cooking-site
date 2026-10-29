"use client";
import { useState } from "react";
import { useCatalogReady } from "./catalog-admin-forms";
type Option = { id: string; name: string; slug?: string };
export function AdminIngredientPicker({
  value,
  selected,
  onChange,
}: {
  value: string;
  selected: Option[];
  onChange: (id: string, item?: Option) => void;
}) {
  const ready = useCatalogReady();
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<Option[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current =
    selected.find((i) => i.id === value) ?? items.find((i) => i.id === value);
  const [chosen, setChosen] = useState<Option | null>(null);
  const pinned = current ?? (chosen?.id === value ? chosen : null);
  const options = [
    ...(pinned ? [pinned] : []),
    ...items.filter((i) => i.id !== pinned?.id),
  ];
  return (
    <div>
      <label>
        Поиск ингредиента
        <input
          maxLength={100}
          value={query}
          disabled={!ready || busy}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary"
        disabled={!ready || busy || !query.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch(
              `/api/catalog?query=${encodeURIComponent(query)}`,
            );
            if (!r.ok) throw new Error("Поиск недоступен. Повторите запрос.");
            setItems((await r.json()).items);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Найти продукт
      </button>
      <label>
        Ингредиент
        <select
          aria-label="Ингредиент"
          required
          disabled={!ready || busy}
          value={value}
          onChange={(e) => {
            setChosen(options.find((i) => i.id === e.target.value) ?? null);
            onChange(
              e.target.value,
              options.find((i) => i.id === e.target.value),
            );
          }}
        >
          <option value="">Выберите</option>
          {options.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {i.slug ? ` (${i.slug})` : ""}
            </option>
          ))}
        </select>
      </label>
      <p role="status">
        {busy
          ? "Поиск…"
          : error ||
            `${items.length} результатов, не более 10. Выбранный UUID сохраняется.`}
      </p>
    </div>
  );
}
