import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { IngredientForm } from "@/components/admin-forms";
import { AdminNav } from "@/components/admin-nav";
export default async function AdminIngredients() {
  await requireAdminSession();
  const repo = recipeRepository();
  const [rows, units] = await Promise.all([
    repo.listIngredients(),
    repo.listUnits(),
  ]);
  return (
    <main>
      <AdminNav />
      <h1>Ингредиенты</h1>
      <h2>Новый ингредиент</h2>
      <IngredientForm units={units} />
      <h2>Существующие ингредиенты</h2>
      {rows.map((x) => (
        <details key={x.ingredient.id}>
          <summary>{x.ingredient.name}</summary>
          <IngredientForm
            initial={{
              ...x.ingredient,
              nutrition: x.nutrition
                ? { ...x.nutrition, sourceNote: x.nutrition.sourceNote ?? "" }
                : null,
            }}
            units={units}
          />
        </details>
      ))}
    </main>
  );
}
