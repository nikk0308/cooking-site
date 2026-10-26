import { eq } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import { recipeRepository } from "./repository";
import { ingredients, recipes, standardUnitIds } from "../../../db/schema";
const items = [
  ["Творог", "tvorog", "100", "g", "121", "17", "5", "2"],
  ["Яйцо", "yaytso", "1", "pcs", "70", "6", "5", "0.4"],
  ["Мука", "muka", "100", "g", "364", "10", "1", "76"],
  ["Молоко", "moloko", "100", "ml", "52", "2.8", "2.5", "4.7"],
  ["Овсяные хлопья", "ovsyanka", "100", "g", "370", "13", "7", "62"],
  ["Куриная грудка", "kuritsa", "100", "g", "120", "23", "2", "0"],
  ["Рис", "ris", "100", "g", "350", "7", "1", "78"],
  ["Макароны", "makarony", "100", "g", "350", "12", "1.5", "72"],
  ["Томаты", "tomaty", "100", "g", "20", "1", "0.2", "4"],
  ["Огурец", "ogurets", "100", "g", "15", "0.8", "0.1", "3"],
] as const;
export async function seedDemo(db = getDatabase()) {
  // One transaction makes the whole seed repeatable even after an interrupted command.
  await db.transaction(async (tx) => {
    const repo = recipeRepository(tx as unknown as typeof db);
    const ids: Record<string, string> = {};
    for (const [
      name,
      slug,
      basisQuantity,
      unit,
      caloriesKcal,
      proteinG,
      fatG,
      carbohydratesG,
    ] of items) {
      const [existing] = await tx
        .select()
        .from(ingredients)
        .where(eq(ingredients.slug, slug));
      ids[slug] =
        existing?.id ??
        (await repo.saveIngredient({
          name,
          slug,
          nutrition: {
            basisQuantity,
            basisUnitId: standardUnitIds[unit],
            caloriesKcal,
            proteinG,
            fatG,
            carbohydratesG,
            sourceNote: "Демо-данные для тестирования",
          },
        }));
    }
    const demos = [
      {
        title: "Сырники",
        slug: "syrniki",
        lines: [
          ["tvorog", "500", "g"],
          ["yaytso", "2", "pcs"],
          ["muka", "100", "g"],
        ],
        steps: [
          "Смешайте творог, яйца и муку. Сформируйте небольшие сырники.",
          "Готовьте на антипригарной сковороде на умеренном огне до румяной корочки с обеих сторон.",
        ],
      },
      {
        title: "Омлет",
        slug: "omlet",
        lines: [
          ["yaytso", "4", "pcs"],
          ["moloko", "200", "ml"],
        ],
        steps: [
          "Взбейте яйца с молоком.",
          "Вылейте в форму и запекайте при 180 °C до полного схватывания.",
        ],
      },
      {
        title: "Овсяная каша",
        slug: "ovsyanaya-kasha",
        lines: [
          ["ovsyanka", "200", "g"],
          ["moloko", "600", "ml"],
        ],
        steps: [
          "Нагрейте молоко, всыпьте хлопья.",
          "Варите на слабом огне, помешивая, до мягкости.",
        ],
      },
      {
        title: "Куриная грудка с рисом",
        slug: "kurinaya-grudka-s-risom",
        lines: [
          ["kuritsa", "600", "g"],
          ["ris", "300", "g"],
        ],
        steps: [
          "Отварите рис в воде до готовности.",
          "Нарежьте грудку и потушите до полной готовности. Подавайте с рисом.",
        ],
      },
      {
        title: "Паста с томатным соусом",
        slug: "pasta-s-tomatnym-sousom",
        lines: [
          ["makarony", "400", "g"],
          ["tomaty", "500", "g"],
        ],
        steps: [
          "Отварите макароны по инструкции на упаковке.",
          "Нарежьте и потушите томаты. Соедините с макаронами.",
        ],
      },
      {
        title: "Овощной салат",
        slug: "ovoschnoy-salat",
        lines: [
          ["tomaty", "300", "g"],
          ["ogurets", "300", "g"],
        ],
        steps: [
          "Вымойте и нарежьте овощи.",
          "Смешайте в миске и подавайте свежими.",
        ],
      },
    ];
    for (const d of demos) {
      if (
        (
          await tx
            .select({ id: recipes.id })
            .from(recipes)
            .where(eq(recipes.slug, d.slug))
        ).length
      )
        continue;
      await repo.saveRecipe({
        title: d.title,
        slug: d.slug,
        description: "Простой домашний рецепт. Демо-данные для проверки сайта.",
        baseServings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: d.slug === "ovoschnoy-salat" ? 0 : 20,
        status: "PUBLISHED",
        coverMediaId: null,
        ingredients: d.lines.map(([slug, quantity, unit]) => ({
          ingredientId: ids[slug],
          quantity,
          unitId: standardUnitIds[unit as keyof typeof standardUnitIds],
          groupLabel: "Основные ингредиенты",
          note: "",
        })),
        steps: d.steps,
      });
    }
  });
}
