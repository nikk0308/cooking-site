import { z } from "zod";
import { eq } from "drizzle-orm";
import { catalogRepository } from "@/modules/catalog/repository";
import { getDatabase } from "@/platform/db/client";
import { units } from "../../../../db/schema";
import { nutritionDocument, unitDocument } from "@/modules/recipes/document";
export async function GET(request: Request) {
  const query = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .safeParse(new URL(request.url).searchParams.get("query"));
  if (!query.success)
    return Response.json(
      { error: "Запрос: от 1 до 100 символов." },
      { status: 400 },
    );
  const db = getDatabase(),
    rows = await catalogRepository(db).search({ query: query.data, limit: 10 });
  const items = await Promise.all(
    rows.map(async (r) => {
      let nutrition = null;
      if (r.nutrition) {
        const n = r.nutrition,
          basis = (
            await db
              .select()
              .from(units)
              .where(eq(units.id, n.basisUnitId))
              .limit(1)
          )[0];
        if (basis)
          nutrition = nutritionDocument.parse({
            basisQuantity: n.basisQuantity,
            basisUnit: unitDocument.parse({
              code: basis.code,
              name: basis.name,
              symbol: basis.symbol,
              dimension: basis.dimension,
              factorToBase: basis.factorToBase,
            }),
            caloriesKcal: n.caloriesKcal,
            proteinG: n.proteinG,
            fatG: n.fatG,
            carbohydratesG: n.carbohydratesG,
            source: {
              kind: n.sourceKind,
              note: n.sourceNote,
              url: n.sourceUrl,
              identifier: n.sourceIdentifier,
            },
          });
      }
      return {
        id: r.ingredient.id,
        name: r.ingredient.name,
        slug: r.ingredient.slug,
        nutrition,
      };
    }),
  );
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
