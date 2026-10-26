import { requireAdminSession } from "@/modules/admin/session";
import { redirect } from "next/navigation";
export default async function Admin() {
  await requireAdminSession();
  redirect("/admin/recipes");
}
