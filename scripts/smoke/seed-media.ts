import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDatabase, closePool } from "../../src/platform/db/client";
import { media, recipes } from "../../db/schema";
import { storeImage } from "../../src/modules/media/storage";
const data = await sharp({
  create: { width: 16, height: 16, channels: 3, background: "#557755" },
})
  .png()
  .toBuffer();
try {
  const image = await storeImage(data);
  const [row] = await getDatabase().insert(media).values(image).returning();
  await getDatabase()
    .update(recipes)
    .set({ coverMediaId: row.id })
    .where(eq(recipes.slug, "syrniki"));
} finally {
  await closePool();
}
