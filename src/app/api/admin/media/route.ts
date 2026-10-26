import { unlink } from "node:fs/promises";
import { requireAdminSession } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
import {
  storeImage,
  maxUpload,
  mediaPath,
  mediaRoot,
} from "@/modules/media/storage";
import { boundedBody } from "@/platform/http";
import { getDatabase } from "@/platform/db/client";
import { media } from "../../../../../db/schema";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await requireAdminSession();
  try {
    const image = await storeImage(await boundedBody(request, maxUpload));
    try {
      const [row] = await getDatabase().insert(media).values(image).returning();
      return Response.json({ id: row.id, key: row.storageKey });
    } catch (e) {
      await unlink(mediaPath(mediaRoot(), image.storageKey));
      throw e;
    }
  } catch {
    return Response.json(
      {
        error:
          "Изображение не принято. JPEG, PNG или WebP, до 10 МБ и 20 млн пикселей.",
      },
      { status: 400 },
    );
  }
}
