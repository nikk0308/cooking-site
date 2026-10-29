import Link from "next/link";
import { z } from "zod";
import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { catalogRepository } from "@/modules/catalog/repository";
import { catalogAdmin } from "@/modules/catalog/admin";
import { CatalogIngredientForm } from "@/components/catalog-admin-forms";
import { AdminNav } from "@/components/admin-nav";
export default async function AdminIngredients({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const p = await searchParams;
  const query = z
    .string()
    .max(100)
    .catch("")
    .parse(p.q ?? "");
  const categoryId = z
    .uuid()
    .optional()
    .catch(undefined)
    .parse(p.category || undefined);
  let cursor: { name: string; id: string } | undefined;
  if (
    typeof p.after === "string" &&
    typeof p.afterId === "string" &&
    z.uuid().safeParse(p.afterId).success &&
    p.after.length <= 256
  )
    cursor = { name: p.after, id: p.afterId };
  const [rows, units, categories] = await Promise.all([
    catalogRepository().search({ query, categoryId, cursor, limit: 50 }),
    recipeRepository().listUnits(),
    catalogAdmin().categories(),
  ]);
  const last = rows.at(-1)?.ingredient;
  const next = last
    ? new URLSearchParams({
        q: query,
        ...(categoryId ? { category: categoryId } : {}),
        after: last.normalizedName ?? last.name,
        afterId: last.id,
      }).toString()
    : "";
  return (
    <main>
      <AdminNav />
      <h1>Ингредиенты</h1>
      <p>
        <Link href="/admin/categories">Категории</Link> ·{" "}
        <Link href="/admin/ingredients/import">Импорт CSV / JSON</Link>
      </p>
      <h2>Новый ингредиент</h2>
      <CatalogIngredientForm units={units} categories={categories} />
      <h2>Каталог</h2>
      <form method="get">
        <label>
          Поиск по названию и синонимам
          <input name="q" maxLength={100} defaultValue={query} />
        </label>
        <label>
          Фильтр категории
          <select name="category" defaultValue={categoryId ?? ""}>
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button>Найти ингредиенты</button>
      </form>
      <p>
        Показано: {rows.length}. Запросы из 1–2 символов ищут начало названия
        или синонима.
      </p>
      <ul>
        {rows.map((r) => (
          <li key={r.ingredient.id}>
            <Link href={`/admin/ingredients/${r.ingredient.id}`}>
              {r.ingredient.name}
            </Link>{" "}
            — {r.ingredient.slug} · {r.category?.name ?? "Без категории"} ·{" "}
            {r.nutrition ? "КБЖУ указаны" : "КБЖУ неизвестны"}
          </li>
        ))}
      </ul>
      {rows.length === 50 && (
        <Link href={`/admin/ingredients?${next}`}>Следующие 50</Link>
      )}
    </main>
  );
}
