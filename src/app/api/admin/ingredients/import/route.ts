import { z } from "zod";
import { requireAdminSession } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
import { catalogImporter } from "@/modules/catalog/importer";
import { catalogHttpError } from "@/modules/catalog/http";
import { importMaxBytes } from "@/modules/catalog/import-format";
import { boundedBody } from "@/platform/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    // The raw file is read once, bounded, and revalidated server-side on both requests.
    const params = new URL(request.url).searchParams;
    const format = z.enum(["csv", "json"]).parse(params.get("format"));
    const action = z.enum(["preview", "apply"]).parse(params.get("action"));
    const decisionHeader = request.headers.get("x-catalog-decisions") ?? "{}";
    if (decisionHeader.length > 32000)
      return Response.json(
        { error: "Слишком много решений в одной части." },
        { status: 400 },
      );
    const decisions = JSON.parse(decodeURIComponent(decisionHeader)) as unknown;
    const bytes = await boundedBody(request, importMaxBytes);
    const service = catalogImporter();
    return Response.json(
      action === "preview"
        ? await service.preview(bytes, format, decisions)
        : await service.apply(
            bytes,
            format,
            request.headers.get("x-catalog-plan") ?? "",
            decisions,
          ),
    );
  } catch (e) {
    return catalogHttpError(e);
  }
}
