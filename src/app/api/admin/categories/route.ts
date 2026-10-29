import { requireAdminSession } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
import { catalogAdmin } from "@/modules/catalog/admin";
import { catalogHttpError } from "@/modules/catalog/http";
import { readJson } from "@/platform/http";
import { z } from "zod";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    return Response.json(
      await catalogAdmin().saveCategory(await readJson(request)),
    );
  } catch (e) {
    return catalogHttpError(e);
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    const { id } = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    await catalogAdmin().removeCategory(id);
    return Response.json({ deleted: true });
  } catch (e) {
    return catalogHttpError(e);
  }
}
