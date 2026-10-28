"use client";
import { useRef, useState } from "react";
import {
  nutritionDocument,
  type RecipeDocument,
} from "@/modules/recipes/document";
type Line = RecipeDocument["ingredients"][number];
export function CatalogPicker({
  select,
}: {
  select: (item: {
    id: string;
    name: string;
    nutrition: Line["nutrition"];
  }) => void;
}) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<
      { id: string; name: string; nutrition: Line["nutrition"] }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  return (
    <details>
      <summary>Выбрать продукт из общего каталога</summary>
      <p className="muted">
        Только этот поисковый запрос отправляется серверу после нажатия. Личный
        рецепт не отправляется.
      </p>
      <label>
        Запрос каталога
        <input
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              searchButton.current?.click();
            }
          }}
        />
      </label>
      <button
        ref={searchButton}
        type="button"
        disabled={!query.trim() || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const response = await fetch(
              `/api/catalog?query=${encodeURIComponent(query.trim())}`,
            );
            if (!response.ok) throw new Error();
            const data = await response.json();
            setRows(
              data.items.map(
                (r: { id: string; name: string; nutrition: unknown }) => ({
                  ...r,
                  nutrition:
                    r.nutrition === null
                      ? null
                      : nutritionDocument.parse(r.nutrition),
                }),
              ),
            );
          } catch {
            setError(
              "Каталог временно недоступен. Можно ввести личный ингредиент вручную.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Найти в каталоге
      </button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="secondary"
              onClick={() => select(r)}
            >
              Выбрать {r.name}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
