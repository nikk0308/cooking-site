import { requireAdminSession } from "@/modules/admin/session";
import { catalogAdmin } from "@/modules/catalog/admin";
import { AdminNav } from "@/components/admin-nav";
import { CategoryManager } from "@/components/catalog-admin-forms";
export default async function Categories({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminSession();
  const { q = "" } = await searchParams;
  const rows = await catalogAdmin().categories(q.slice(0, 100));
  return (
    <main>
      <AdminNav />
      <h1>Категории ингредиентов</h1>
      <form method="get">
        <label>
          Найти категорию
          <input name="q" defaultValue={q} maxLength={100} />
        </label>
        <button>Искать</button>
      </form>
      <CategoryManager rows={rows} />
    </main>
  );
}
