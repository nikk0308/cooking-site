import { z } from "zod";
import { resolvePublicDocuments } from "@/modules/recipes/public-documents";
export async function GET(request: Request) {
  const ids = z
    .array(z.uuid())
    .min(1)
    .max(100)
    .safeParse(new URL(request.url).searchParams.getAll("id"));
  if (!ids.success)
    return Response.json(
      { error: "Укажите от 1 до 100 UUID публичных рецептов." },
      { status: 400 },
    );
  return Response.json(
    { recipes: await resolvePublicDocuments(ids.data) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
