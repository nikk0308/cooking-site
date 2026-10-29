import { requireAdminSession } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
import { catalogAdmin } from "@/modules/catalog/admin";
import { catalogHttpError } from "@/modules/catalog/http";
import { readJson } from "@/platform/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    const saved = await catalogAdmin().save(await readJson(request));
    return Response.json({ id: saved.id, expected: saved.expected });
  } catch (e) {
    return catalogHttpError(e);
  }
}
