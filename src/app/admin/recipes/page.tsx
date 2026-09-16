import Link from "next/link";
import { requireAdminSession } from "@/modules/admin/session";
import { recipeRepository } from "@/modules/recipes/repository";
import { AdminNav } from "@/components/admin-nav";
export default async function AdminRecipes() {
  await requireAdminSession();
  const rows = await recipeRepository().listAdminRecipes();
  return (
    <main>
      <AdminNav />
      <h1>Управление рецептами</h1>
      <Link className="button" href="/admin/recipes/new">
        Новый рецепт
      </Link>
      <ul className="admin-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={"/admin/recipes/" + r.id}>{r.title}</Link> ·{" "}
            {
              {
                DRAFT: "Черновик",
                PUBLISHED: "Опубликован",
                ARCHIVED: "Архив",
              }[r.status]
            }
          </li>
        ))}
      </ul>
      {!rows.length && <p>Рецептов пока нет.</p>}
    </main>
  );
}
