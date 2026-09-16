import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import { media, recipes } from "../../../../db/schema";
import { mediaPath, mediaRoot } from "@/modules/media/storage";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;
    const filename = mediaPath(mediaRoot(), key);
    const [row] = await getDatabase()
      .select({ id: media.id })
      .from(media)
      .innerJoin(recipes, eq(recipes.coverMediaId, media.id))
      .where(and(eq(media.storageKey, key), eq(recipes.status, "PUBLISHED")))
      .limit(1);
    if (!row) return new Response(null, { status: 404 });
    return new Response(await readFile(filename), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
