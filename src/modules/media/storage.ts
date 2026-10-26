import path from "node:path";
import { mkdir, open, rename, unlink, realpath } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
export const maxUpload = 10 * 1024 * 1024;
export function mediaPath(root: string, key: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/.test(
      key,
    )
  )
    throw new Error("Invalid media key");
  return path.join(path.resolve(root), key);
}
export function mediaRoot() {
  return process.env.MEDIA_ROOT ?? path.resolve(".local-media");
}
export async function checkMediaStorage() {
  const root = await realpath(mediaRoot());
  const probe = path.join(root, `.ready-${randomUUID()}`);
  const file = await open(probe, "wx", 0o600);
  try {
    await file.write("1");
  } finally {
    await file.close();
    await unlink(probe);
  }
}
export async function storeImage(input: Uint8Array) {
  if (!input.length || input.length > maxUpload)
    throw new Error("Invalid image size");
  const pipeline = sharp(input, {
    limitInputPixels: 20_000_000,
    failOn: "warning",
  });
  const meta = await pipeline.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) !== 1
  )
    throw new Error("Unsupported image");
  const { data, info } = await pipeline
    .rotate()
    .resize({
      width: 2000,
      height: 2000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const root = mediaRoot();
  await mkdir(root, { recursive: true });
  const storageKey = `${randomUUID()}.webp`,
    destination = mediaPath(root, storageKey),
    temp = path.join(path.resolve(root), `.upload-${randomUUID()}`);
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(data);
    } finally {
      await file.close();
    }
    await rename(temp, destination);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return {
    storageKey,
    mimeType: "image/webp",
    width: info.width,
    height: info.height,
    sizeBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
