import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { RecipeForm } from "@/components/admin-forms";
import { AdminNav } from "@/components/admin-nav";
export default async function NewRecipe() {
  await requireAdminSession();
  const repo = recipeRepository();
  const [ingredients, units] = await Promise.all([
    repo.listIngredients(),
    repo.listUnits(),
  ]);
  return (
    <main>
      <AdminNav />
      <h1>Новый рецепт</h1>
      <RecipeForm
        ingredients={ingredients.map((x) => x.ingredient)}
        units={units}
      />
    </main>
  );
}
