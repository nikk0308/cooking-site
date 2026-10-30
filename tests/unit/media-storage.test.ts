import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const controls = vi.hoisted(() => ({
  ids: [] as string[],
  failRename: false,
  insertFailure: vi.fn(async () => {
    throw new Error("SYNTHETIC_DATABASE_FAILURE");
  }),
}));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => controls.ids.shift() ?? actual.randomUUID(),
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (controls.failRename) throw new Error("SYNTHETIC_RENAME_FAILURE");
      return actual.rename(...args);
    },
  };
});
vi.mock("@/modules/admin/session", () => ({
  requireAdminSession: async () => ({ id: "synthetic" }),
}));
vi.mock("@/platform/db/client", () => ({
  getDatabase: () => ({
    insert: () => ({
      values: () => ({
        returning: controls.insertFailure,
      }),
    }),
  }),
}));
import { storeImage, checkMediaStorage } from "@/modules/media/storage";
import { POST } from "@/app/api/admin/media/route";
let root: string;
let input: Buffer;
const priorRoot = process.env.MEDIA_ROOT;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "culinote-media-unit-"));
  process.env.MEDIA_ROOT = root;
  controls.ids = [];
  controls.failRename = false;
  controls.insertFailure.mockClear();
  input = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
});
afterEach(async () => {
  if (priorRoot === undefined) delete process.env.MEDIA_ROOT;
  else process.env.MEDIA_ROOT = priorRoot;
  if (
    path.dirname(root) !== os.tmpdir() ||
    !path.basename(root).startsWith("culinote-media-unit-")
  )
    throw new Error("UNSAFE_TEST_CLEANUP");
  await rm(root, { recursive: true });
});
it("preserves an existing immutable destination on UUID collision", async () => {
  const id = "50000000-0000-4000-8000-000000000001";
  await writeFile(path.join(root, id + ".webp"), "existing immutable content");
  controls.ids = [id];
  await expect(storeImage(input)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path.join(root, id + ".webp"), "utf8")).toBe(
    "existing immutable content",
  );
  expect(await readdir(root)).toEqual([id + ".webp"]);
});
it("does not remove an exclusive temporary file owned by a different attempt", async () => {
  const id = "50000000-0000-4000-8000-000000000002";
  await writeFile(
    path.join(root, ".upload-" + id),
    "existing temporary content",
  );
  controls.ids = ["50000000-0000-4000-8000-000000000003", id];
  await expect(storeImage(input)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path.join(root, ".upload-" + id), "utf8")).toBe(
    "existing temporary content",
  );
});
it("cleans its temporary file and reservation after failed rename", async () => {
  controls.failRename = true;
  await expect(storeImage(input)).rejects.toThrow("SYNTHETIC_RENAME_FAILURE");
  expect(await readdir(root)).toEqual([]);
});
it("cleans a completed image when the protected upload database insertion fails", async () => {
  const response = await POST(
    new Request("http://localhost/api/admin/media", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        host: "localhost",
        "content-type": "image/png",
      },
      body: new Uint8Array(input),
    }),
  );
  expect(response.status).toBe(400);
  expect(controls.insertFailure).toHaveBeenCalledOnce();
  expect(await readdir(root)).toEqual([]);
});
it("keeps successful content intact across later writes and readiness probes", async () => {
  const first = await storeImage(input);
  const bytes = await readFile(path.join(root, first.storageKey));
  await storeImage(input);
  await checkMediaStorage();
  expect(await readFile(path.join(root, first.storageKey))).toEqual(bytes);
  expect((await readdir(root)).filter((n) => n.startsWith("."))).toEqual([]);
});
