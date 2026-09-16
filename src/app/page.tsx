import Link from "next/link";
import { recipeRepository } from "@/modules/recipes/repository";
import { recipeNutrition } from "@/modules/recipes/presentation";
import { Cover } from "@/components/cover";
export const dynamic = "force-dynamic";
export default async function Home() {
  const recipes = await recipeRepository().listPublishedRecipes();
  return (
    <main>
      <h1>Рецепты</h1>
      <p className="muted">
        Выберите блюдо, настройте порции и соберите список продуктов.
      </p>
      {!recipes.length ? (
        <p className="panel">Пока нет опубликованных рецептов.</p>
      ) : (
        <div className="cards">
          {recipes.map((r) => {
            const n = recipeNutrition(r);
            return (
              <Link className="card" href={"/recipes/" + r.slug} key={r.id}>
                <Cover image={r.cover} title={r.title} />
                <div className="card-body">
                  <h2>{r.title}</h2>
                  <p>{r.description}</p>
                  <p className="muted">
                    {(r.prepTimeMinutes ?? 0) + (r.cookTimeMinutes ?? 0)} мин ·{" "}
                    {r.baseServings} порции
                  </p>
                  <p>
                    {n.coverage.complete
                      ? n.perServing.caloriesKcal.toDecimalPlaces(1).toFixed() +
                        " ккал на порцию"
                      : "КБЖУ рассчитано частично"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
