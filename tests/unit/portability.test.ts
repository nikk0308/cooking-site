import { expect, it } from "vitest";
import sharp from "sharp";
import { mergePlan } from "@/platform/browser/portability";
import { imageHeader, validateImage } from "@/platform/browser/images";
import { prepareImport } from "@/platform/browser/portability";
import { localRecipe } from "../helpers/v02";
import { emptyShopping } from "@/modules/shopping/document";
import type { BrowserSnapshot } from "@/platform/browser/repository";
import type { PortableData } from "@/platform/browser/portability";
const target = (): BrowserSnapshot => ({
  revision: 0,
  recipes: [],
  photos: [],
  favorites: { schemaVersion: 1, items: [] },
  shopping: emptyShopping(),
});
const incoming = (): PortableData => ({
  application: "culinote",
  schemaVersion: 1,
  createdAt: "2026-10-28T00:00:00Z",
  recipes: [localRecipe()],
  photos: [],
  favorites: { schemaVersion: 1, items: [] },
  shopping: emptyShopping(),
});
it("plans additive import, skips identical records and blocks conflicting IDs", () => {
  const t = target(),
    data = incoming();
  expect(mergePlan(t, data, [], new Map())).toMatchObject({
    skipped: 0,
    recipes: [localRecipe()],
    conflicts: [],
  });
  t.recipes = [localRecipe()];
  expect(mergePlan(t, data, [], new Map())).toMatchObject({
    skipped: 1,
    recipes: [],
    conflicts: [],
  });
  data.recipes[0].title = "Different";
  expect(mergePlan(t, data, [], new Map()).conflicts).toHaveLength(1);
});
it("unions namespaced favorites and never silently replaces a nonempty shopping list", () => {
  const t = target(),
    data = incoming(),
    ref = localRecipe().reference;
  t.favorites.items = [ref];
  data.favorites.items = [{ ...ref, kind: "PUBLIC" }];
  t.shopping.recipes = [
    {
      id: ref.id,
      reference: ref,
      selectedServings: 4,
      addedAt: "2026-10-28T00:00:00Z",
    },
  ];
  data.shopping.recipes = [{ ...t.shopping.recipes[0], selectedServings: 6 }];
  const plan = mergePlan(t, data, [], new Map());
  expect(plan.favorites.items).toHaveLength(2);
  expect(plan.conflicts).toHaveLength(1);
  expect(plan.shopping).toEqual(t.shopping);
});
it("compares photo byte hashes, not only MIME or byte length", () => {
  const t = target(),
    data = incoming(),
    id = crypto.randomUUID();
  const photo = {
    schemaVersion: 1 as const,
    id,
    recipeId: data.recipes[0].reference.id,
    blob: new Blob(["one"], { type: "image/png" }),
  };
  t.photos = [photo];
  expect(
    mergePlan(
      t,
      data,
      [photo],
      new Map([
        [`old:${id}`, "a"],
        [`new:${id}`, "b"],
      ]),
    ).conflicts,
  ).toHaveLength(1);
});
it.each(["png", "jpeg", "webp"] as const)(
  "reads real %s dimensions before decode",
  async (format) => {
    const buffer = await sharp({
      create: { width: 23, height: 17, channels: 3, background: "#334455" },
    })
      .toFormat(format)
      .toBuffer();
    expect(imageHeader(buffer)).toMatchObject({
      width: 23,
      height: 17,
      mime: `image/${format}`,
    });
  },
);
it("rejects SVG and truncated files regardless of filename/MIME claims", () => {
  expect(() => imageHeader(new TextEncoder().encode("<svg/>"))).toThrow();
  expect(() => imageHeader(new Uint8Array([0xff, 0xd8, 0x00]))).toThrow();
});
it("checks file and photo size bounds before parsing or decoding", async () => {
  const file = new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]);
  const repo = {} as Parameters<typeof prepareImport>[1];
  await expect(prepareImport(file, repo)).rejects.toThrow("64 МиБ");
  await expect(
    validateImage(
      new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" }),
    ),
  ).rejects.toThrow();
});
it("retains existing shopping when incoming is empty and adopts into an empty target", () => {
  const t = target(),
    data = incoming();
  t.shopping.overrides = [
    { id: "preserved", quantity: "0.123", purchased: true },
  ];
  expect(mergePlan(t, data, [], new Map()).shopping).toEqual(t.shopping);
  data.shopping = t.shopping;
  expect(mergePlan(target(), data, [], new Map()).shopping).toEqual(t.shopping);
});
it("rejects animated PNG/WebP headers before decoding", async () => {
  const p = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  p.write("acTL", 37, "ascii");
  expect(() => imageHeader(p)).toThrow();
  const w = Buffer.alloc(30);
  w.write("RIFF");
  w.writeUInt32LE(22, 4);
  w.write("WEBPVP8X", 8);
  w.writeUInt32LE(10, 16);
  w[20] = 2;
  expect(() => imageHeader(w)).toThrow("Анимированные");
});
it.each([false, true])(
  "reads WebP alpha/lossless headers safely (lossless=%s)",
  async (lossless) => {
    const bytes = await sharp({
      create: {
        width: 19,
        height: 21,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 0.5 },
      },
    })
      .webp({ lossless })
      .toBuffer();
    expect(imageHeader(bytes)).toMatchObject({ width: 19, height: 21 });
  },
);
