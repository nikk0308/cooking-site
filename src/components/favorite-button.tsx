"use client";
import { useEffect, useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import type { RecipeReference } from "@/modules/recipes/reference";
export function FavoriteButton({
  reference,
  title,
}: {
  reference: RecipeReference;
  title: string;
}) {
  const { repo, revision, notify } = useBrowserData();
  const [value, setValue] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (repo)
      repo.favorites
        .has(reference)
        .then((v) => {
          if (active) setValue(v);
        })
        .catch((e) => {
          if (active) setMessage(browserError(e));
        });
    return () => {
      active = false;
    };
  }, [repo, revision, reference.kind, reference.id, reference]);
  return (
    <div className="favorite-control">
      <button
        type="button"
        className="secondary"
        disabled={!repo || value === null || busy}
        aria-pressed={value ?? false}
        aria-label={`${value ? "Убрать из избранного" : "В избранное"}: ${title}`}
        onClick={async () => {
          if (!repo || value === null) return;
          setBusy(true);
          setMessage("");
          try {
            if (value) await repo.favorites.remove(reference);
            else await repo.favorites.add(reference);
            setValue(!value);
            setMessage(
              value ? "Убрано из избранного" : "Добавлено в избранное",
            );
            notify();
          } catch (e) {
            setMessage(browserError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {value ? "♥ В избранном" : "♡ В избранное"}
      </button>
      <span aria-live="polite">{message}</span>
    </div>
  );
}
