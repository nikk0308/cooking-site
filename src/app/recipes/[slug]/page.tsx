import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { recipeRepository } from "@/modules/recipes/repository";
import { Cover } from "@/components/cover";
import { RecipeControls } from "@/components/recipe-controls";
export const dynamic = "force-dynamic";
const find = cache((slug: string) =>
  recipeRepository().findPublishedRecipeBySlug(slug),
);
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const r = await find((await params).slug);
  if (!r) notFound();
  return {
    title: r.title + " · Recipes",
    description: r.description,
    alternates: { canonical: "/recipes/" + r.slug },
    openGraph: {
      title: r.title,
      description: r.description ?? "",
      type: "article",
      ...(r.cover ? { images: ["/media/" + r.cover.storageKey] } : {}),
    },
  };
}
export default async function RecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const recipe = await find((await params).slug);
  if (!recipe) notFound();
  const json = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.title,
    description: recipe.description,
    recipeYield: recipe.baseServings + " порции",
    prepTime: "PT" + (recipe.prepTimeMinutes ?? 0) + "M",
    cookTime: "PT" + (recipe.cookTimeMinutes ?? 0) + "M",
    recipeIngredient: recipe.ingredients.map(
      (x) => x.line.quantity + " " + x.unit.symbol + " " + x.ingredient.name,
    ),
    recipeInstructions: recipe.steps.map((s) => ({
      "@type": "HowToStep",
      text: s.instruction,
    })),
    ...(recipe.cover ? { image: "/media/" + recipe.cover.storageKey } : {}),
  };
  return (
    <main>
      <h1>{recipe.title}</h1>
      <div className="recipe-top">
        <Cover image={recipe.cover} title={recipe.title} />
        <div>
          <p>{recipe.description}</p>
          <p>Подготовка: {recipe.prepTimeMinutes ?? "—"} мин</p>
          <p>Приготовление: {recipe.cookTimeMinutes ?? "—"} мин</p>
        </div>
      </div>
      <RecipeControls recipe={recipe} />
      <h2>Приготовление</h2>
      <ol className="steps">
        {recipe.steps.map((s) => (
          <li key={s.id}>{s.instruction}</li>
        ))}
      </ol>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(json).replace(/</g, "\\u003c"),
        }}
      />
    </main>
  );
}
