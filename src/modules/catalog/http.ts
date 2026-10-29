import { safeError } from "@/platform/http";
import { CatalogError } from "./input";
export function catalogHttpError(error: unknown) {
  return error instanceof CatalogError
    ? Response.json(
        { error: error.message },
        { status: error.message.startsWith("STALE_PLAN") ? 409 : 400 },
      )
    : safeError(error);
}
