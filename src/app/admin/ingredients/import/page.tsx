import { requireAdminSession } from "@/modules/admin/session";
import { AdminNav } from "@/components/admin-nav";
import { CatalogImportForm } from "@/components/catalog-import-form";
export default async function ImportCatalog() {
  await requireAdminSession();
  return (
    <main>
      <AdminNav />
      <h1>Импорт каталога</h1>
      <CatalogImportForm />
    </main>
  );
}
