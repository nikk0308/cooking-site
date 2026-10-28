export const maxPhotoBytes = 10 * 1024 * 1024;
export class PhotoError extends Error {
  constructor(
    message = "Не удалось прочитать фото. Используйте исправный JPEG, PNG или WebP до 10 МиБ и 16 мегапикселей.",
  ) {
    super(message);
  }
}
const text = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...b.slice(at, at + n));
// Inspect dimensions before allocating a decoded raster. WebP layout follows
// https://developers.google.com/speed/webp/docs/riff_container
export function imageHeader(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 33 &&
    text(bytes, 0, 8) === "\x89PNG\r\n\x1a\n" &&
    text(bytes, 12, 4) === "IHDR"
  ) {
    for (let i = 8; i + 12 <= bytes.length;) {
      if (text(bytes, i + 4, 4) === "acTL")
        throw new PhotoError("Анимированные изображения не поддерживаются.");
      const size = v.getUint32(i);
      if (i + 12 + size > bytes.length) throw new PhotoError();
      i += 12 + size;
    }
    return {
      mime: "image/png",
      width: v.getUint32(16),
      height: v.getUint32(20),
    };
  }
  if (
    bytes.length >= 30 &&
    text(bytes, 0, 4) === "RIFF" &&
    text(bytes, 8, 4) === "WEBP" &&
    v.getUint32(4, true) + 8 === bytes.length
  ) {
    let canvas: { width: number; height: number } | undefined,
      frame: typeof canvas;
    for (let i = 12; i < bytes.length;) {
      if (i + 8 > bytes.length) throw new PhotoError();
      const format = text(bytes, i, 4),
        size = v.getUint32(i + 4, true),
        at = i + 8;
      if (at + size + (size % 2) > bytes.length) throw new PhotoError();
      if (format === "ANIM" || format === "ANMF")
        throw new PhotoError("Анимированные изображения не поддерживаются.");
      if (format === "VP8X") {
        if (canvas || size !== 10) throw new PhotoError();
        if (bytes[at] & 2)
          throw new PhotoError("Анимированные изображения не поддерживаются.");
        const u24 = (n: number) =>
          bytes[n] | (bytes[n + 1] << 8) | (bytes[n + 2] << 16);
        canvas = { width: 1 + u24(at + 4), height: 1 + u24(at + 7) };
      }
      if (format === "VP8 " || format === "VP8L") {
        if (frame) throw new PhotoError();
        if (
          format === "VP8 " &&
          size >= 10 &&
          text(bytes, at + 3, 3) === "\x9d\x01\x2a"
        )
          frame = {
            width: v.getUint16(at + 6, true) & 0x3fff,
            height: v.getUint16(at + 8, true) & 0x3fff,
          };
        else if (format === "VP8L" && size >= 5 && bytes[at] === 0x2f) {
          const bits = v.getUint32(at + 1, true);
          frame = {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1,
          };
        } else throw new PhotoError();
      }
      i = at + size + (size % 2);
    }
    if (
      !frame ||
      (canvas &&
        (canvas.width !== frame.width || canvas.height !== frame.height))
    )
      throw new PhotoError();
    return { mime: "image/webp", ...frame };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let result: { mime: string; width: number; height: number } | undefined;
    for (let i = 2; i + 4 <= bytes.length;) {
      if (bytes[i++] !== 0xff) throw new PhotoError();
      while (bytes[i] === 0xff) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const size = v.getUint16(i);
      if (size < 2 || i + size > bytes.length) throw new PhotoError();
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8 || result) throw new PhotoError();
        result = {
          mime: "image/jpeg",
          height: v.getUint16(i + 3),
          width: v.getUint16(i + 5),
        };
      }
      i += size;
    }
    if (result) return result;
  }
  throw new PhotoError();
}
export async function validateImage(blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > maxPhotoBytes) throw new PhotoError();
  let header;
  try {
    header = imageHeader(new Uint8Array(await blob.arrayBuffer()));
  } catch (error) {
    throw error instanceof PhotoError ? error : new PhotoError();
  }
  const safe = (w: number, h: number) =>
    w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 16 * 1024 * 1024;
  if (
    !safe(header.width, header.height) ||
    (blob.type && blob.type !== header.mime)
  )
    throw new PhotoError();
  const typed = blob.type ? blob : new Blob([blob], { type: header.mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(typed);
  } catch {
    throw new PhotoError();
  }
  try {
    if (
      !safe(bitmap.width, bitmap.height) ||
      bitmap.width * bitmap.height !== header.width * header.height
    )
      throw new PhotoError();
  } finally {
    bitmap.close();
  }
  return typed;
}
