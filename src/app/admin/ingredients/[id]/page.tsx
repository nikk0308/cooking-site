import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdminSession } from "@/modules/admin/session";
import { catalogAdmin } from "@/modules/catalog/admin";
import { recipeRepository } from "@/modules/recipes/repository";
import { AdminNav } from "@/components/admin-nav";
import { CatalogIngredientForm } from "@/components/catalog-admin-forms";
export default async function EditIngredient({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [product, units, categories] = await Promise.all([
    catalogAdmin().get(id),
    recipeRepository().listUnits(),
    catalogAdmin().categories(),
  ]);
  if (!product) notFound();
  return (
    <main>
      <AdminNav />
      <h1>Изменить ингредиент</h1>
      <p>UUID: {id}</p>
      <CatalogIngredientForm
        initial={product}
        units={units}
        categories={categories}
      />
    </main>
  );
}
