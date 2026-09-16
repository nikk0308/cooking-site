import { requireAdminSession } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
import { recipeRepository } from "@/modules/recipes/repository";
import { readJson, safeError } from "@/platform/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    return Response.json({
      id: await recipeRepository().saveIngredient(await readJson(request)),
    });
  } catch (e) {
    return safeError(e);
  }
}
