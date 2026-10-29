import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { RecipeForm } from "@/components/admin-forms";
import { AdminNav } from "@/components/admin-nav";
export default async function NewRecipe() {
  await requireAdminSession();
  const repo = recipeRepository();
  const units = await repo.listUnits();
  return (
    <main>
      <AdminNav />
      <h1>Новый рецепт</h1>
      <RecipeForm ingredients={[]} units={units} />
    </main>
  );
}
