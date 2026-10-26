import { readJson } from "@/platform/http";
import { resolveBasket } from "@/modules/basket/service";
export async function POST(request: Request) {
  try {
    return Response.json(await resolveBasket(await readJson(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Не удалось обновить список. Проверьте данные и повторите попытку.",
      },
      { status: 400 },
    );
  }
}
