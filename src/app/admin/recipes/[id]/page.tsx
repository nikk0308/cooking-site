import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { RecipeForm } from "@/components/admin-forms";
import { AdminNav } from "@/components/admin-nav";
export default async function EditRecipe({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const repo = recipeRepository();
  const [r, ingredients, units] = await Promise.all([
    repo.findAdminRecipe(id),
    repo.listIngredients(),
    repo.listUnits(),
  ]);
  if (!r) notFound();
  return (
    <main>
      <AdminNav />
      <h1>Редактировать рецепт</h1>
      <RecipeForm
        initial={{
          id: r.id,
          title: r.title,
          slug: r.slug,
          description: r.description ?? "",
          baseServings: r.baseServings,
          prepTimeMinutes: r.prepTimeMinutes,
          cookTimeMinutes: r.cookTimeMinutes,
          status: r.status,
          coverMediaId: r.coverMediaId,
          ingredients: r.ingredients.map((x) => ({
            ...x.line,
            groupLabel: x.line.groupLabel ?? "",
            note: x.line.note ?? "",
          })),
          steps: r.steps.map((s) => s.instruction),
        }}
        ingredients={ingredients.map((x) => x.ingredient)}
        units={units}
      />
    </main>
  );
}
