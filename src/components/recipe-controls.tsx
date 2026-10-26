"use client";
import { useState } from "react";
import type { RecipeAggregate } from "@/modules/recipes/repository";
import { scaleQuantityForServings } from "@/modules/recipes/scaling";
import {
  displayQuantity,
  recipeNutrition,
} from "@/modules/recipes/presentation";
import {
  basketKey,
  parseBasket,
  basketDocument,
} from "@/modules/basket/document";
export function Servings({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="servings">
      <button
        type="button"
        aria-label="Уменьшить порции"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <label>
        Порции
        <input
          aria-label="Порции"
          type="number"
          min="1"
          max="1000"
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= 1 && v <= 1000) onChange(v);
          }}
        />
      </label>
      <button
        type="button"
        aria-label="Увеличить порции"
        disabled={value >= 1000}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
export function RecipeControls({ recipe }: { recipe: RecipeAggregate }) {
  const [servings, setServings] = useState(recipe.baseServings),
    [message, setMessage] = useState("");
  const n = recipeNutrition(recipe);
  const groups = [
    ...new Set(recipe.ingredients.map((x) => x.line.groupLabel ?? "")),
  ];
  function add() {
    try {
      const basket = parseBasket(localStorage.getItem(basketKey));
      const next = basketDocument.parse({
        ...basket,
        items: [
          ...basket.items.filter((i) => i.recipeId !== recipe.id),
          {
            recipeId: recipe.id,
            selectedServings: servings,
            addedAt: new Date().toISOString(),
            schemaVersion: 1,
          },
        ],
      });
      localStorage.setItem(basketKey, JSON.stringify(next));
      setMessage("Добавлено в список продуктов");
    } catch {
      setMessage(
        "Не удалось сохранить список. Проверьте хранилище браузера или очистите список на его странице.",
      );
    }
  }
  const nutrients = [
    { label: "Калории", value: n.perServing.caloriesKcal, unit: "ккал" },
    { label: "Белки", value: n.perServing.proteinG, unit: "г" },
    { label: "Жиры", value: n.perServing.fatG, unit: "г" },
    { label: "Углеводы", value: n.perServing.carbohydratesG, unit: "г" },
  ];
  return (
    <section>
      <h2>Ингредиенты</h2>
      <Servings value={servings} onChange={setServings} />
      {groups.map((group) => (
        <div key={group}>
          {group && <h3>{group}</h3>}
          <ul className="ingredients">
            {recipe.ingredients
              .filter((x) => (x.line.groupLabel ?? "") === group)
              .map((x) => (
                <li key={x.line.id}>
                  <span>
                    {x.ingredient.name}
                    {x.line.note && <small> · {x.line.note}</small>}
                  </span>
                  <strong>
                    {displayQuantity(
                      scaleQuantityForServings({
                        baseQuantity: x.line.quantity,
                        baseServings: recipe.baseServings,
                        targetServings: servings,
                      }),
                      x.unit,
                    )}
                  </strong>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <button onClick={add}>В список продуктов</button>
      <p role="status">{message}</p>
      <h2>КБЖУ на порцию</h2>
      {n.coverage.complete ? (
        <div className="nutrition">
          {nutrients.map((x) => (
            <div key={x.label}>
              <span>{x.label}</span>
              <strong>
                {x.value.toDecimalPlaces(1).toFixed()} {x.unit}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel">
          КБЖУ рассчитано частично. Для {n.missingIngredientIds.length}{" "}
          ингредиентов нет данных или совместимых единиц; полные значения не
          показаны.
        </p>
      )}
    </section>
  );
}
