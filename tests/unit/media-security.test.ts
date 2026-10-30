import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const controls = vi.hoisted(() => ({ decode: vi.fn(), insert: vi.fn() }));
vi.mock("sharp", async (original) => {
  const actual = await original<typeof import("sharp")>();
  return {
    default: new Proxy(actual.default, {
      apply(target, self, args) {
        controls.decode();
        return Reflect.apply(target, self, args);
      },
    }),
  };
});
vi.mock("@/modules/admin/session", () => ({
  requireAdminSession: async () => ({ id: "synthetic" }),
}));
vi.mock("@/platform/db/client", () => ({
  getDatabase: () => ({ insert: controls.insert }),
}));
import { storeImage, maxUpload } from "@/modules/media/storage";
import { POST } from "@/app/api/admin/media/route";
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
);
let root: string;
const prior = process.env.MEDIA_ROOT;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "culinote-media-security-"));
  process.env.MEDIA_ROOT = root;
  controls.decode.mockClear();
  controls.insert.mockClear();
});
afterEach(async () => {
  if (prior === undefined) delete process.env.MEDIA_ROOT;
  else process.env.MEDIA_ROOT = prior;
  if (
    path.dirname(root) !== os.tmpdir() ||
    !path.basename(root).startsWith("culinote-media-security-")
  )
    throw Error("UNSAFE_TEST_CLEANUP");
  await rm(root, { recursive: true });
});
for (const format of ["jpeg", "png", "webp"] as const)
  it(`accepts real ${format}, preserves WebP metadata/content hash`, async () => {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#123456" },
    })
      [format]()
      .toBuffer();
    expect((await sharp(input).metadata()).format).toBe(format);
    const stored = await storeImage(input),
      bytes = await readFile(path.join(root, stored.storageKey));
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(20);
    expect(stored.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(stored.sizeBytes).toBe(bytes.length);
    expect(await readdir(root)).toEqual([stored.storageKey]);
  });
for (const [name, input] of [
  ["SVG", svg],
  ["malformed XML", Buffer.from("<?xml <svg broken")],
  ["TIFF", Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])],
  ["PDF", Buffer.from("%PDF-1.7\nbenign")],
  ["GIF", Buffer.from("GIF89abenign")],
  ["oversized", Buffer.alloc(maxUpload + 1)],
  ["empty", Buffer.alloc(0)],
] as const)
  it(`rejects ${name} BEFORE constructing Sharp and leaves no artifact`, async () => {
    await expect(storeImage(input)).rejects.toThrow();
    expect(controls.decode).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
it("rejects SVG mislabeled image/jpeg before decoder or DB insertion", async () => {
  const response = await POST(
    new Request("http://localhost/api/admin/media", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        "content-type": "image/jpeg",
      },
      body: new Uint8Array(svg),
    }),
  );
  expect(response.status).toBe(400);
  expect(controls.decode).not.toHaveBeenCalled();
  expect(controls.insert).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});
it("blocks actual native SVG metadata loader as defense in depth", async () => {
  await expect(sharp(svg).metadata()).rejects.toThrow(/blocked|unsupported/i);
});
for (const [name, input] of [
  ["truncated JPEG", Buffer.from([255, 216, 255])],
  ["truncated PNG", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ["corrupt WebP", Buffer.from("RIFF0000WEBPVP8 corrupt")],
  [
    "SVG behind PNG signature",
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), svg]),
  ],
] as const)
  it(`rejects ${name} with the patched decoder and no artifacts`, async () => {
    await expect(storeImage(input)).rejects.toThrow();
    expect(controls.decode).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
  });
it("rejects excessive pixels before persistence", async () => {
  const input = await sharp({
    create: { width: 5000, height: 4001, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(storeImage(input)).rejects.toThrow(/pixel limit/i);
  expect(await readdir(root)).toEqual([]);
});
it("rejects real animated WebP pages", async () => {
  const input = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
    raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
  })
    .webp({ loop: 0 })
    .toBuffer();
  expect((await sharp(input).metadata()).pages).toBe(2);
  await expect(storeImage(input)).rejects.toThrow("Unsupported image");
  expect(await readdir(root)).toEqual([]);
});
it("preserves orientation and resize limits", async () => {
  const oriented = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const a = await storeImage(oriented);
  expect([a.width, a.height]).toEqual([20, 40]);
  const large = await sharp({
    create: { width: 2100, height: 21, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const b = await storeImage(large);
  expect(b.width).toBe(2000);
  expect(b.height).toBeLessThanOrEqual(2000);
});
