import {
  readFile,
  mkdir,
  stat,
  readdir,
  writeFile,
  chmod,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
import { storeImage, checkMediaStorage } from "../../src/modules/media/storage";
assert.equal(process.getuid!(), 10001);
const root = "/media";
execFileSync("setfacl", ["-m", "u:10002:r-x,g::---,o::---,m::r-x", root]);
execFileSync("setfacl", [
  "-d",
  "-m",
  "u::rwx,u:10002:r-x,g::---,o::---,m::r-x",
  root,
]);
process.env.MEDIA_ROOT = root;
const input = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "#987654" },
})
  .png()
  .toBuffer();
const published = await storeImage(input);
const bytes = await readFile(root + "/" + published.storageKey);
const draft = await storeImage(input);
await checkMediaStorage();
assert.equal(
  createHash("sha256").update(bytes).digest("hex"),
  published.sha256,
);
assert.deepEqual(await readFile(root + "/" + published.storageKey), bytes);
for (const image of [published, draft]) {
  assert.equal((await stat(root + "/" + image.storageKey)).mode & 0o777, 0o640);
  const acl = execFileSync("getfacl", ["-cpn", root + "/" + image.storageKey], {
    encoding: "utf8",
  });
  assert.match(acl, /user:10002:r-x\s+#effective:r--/);
  assert.match(acl, /other::---/);
}
assert.equal(
  (await readdir(root)).some((n) => n.startsWith(".")),
  false,
);
await mkdir(root + "/unconfigured", { mode: 0o755 });
execFileSync("setfacl", ["-b", root + "/unconfigured"]);
execFileSync("setfacl", ["-k", root + "/unconfigured"]);
await chmod(root + "/unconfigured", 0o755);
process.env.MEDIA_ROOT = root + "/unconfigured";
const unconfigured = await storeImage(input);
const result = {
  published: published.storageKey,
  draft: draft.storageKey,
  unconfigured: unconfigured.storageKey,
  sha256: published.sha256,
};
await writeFile("/tmp/media-result.json", JSON.stringify(result));
console.log(
  "OWNER_WRITE_READ_HASH_RENAME_ACL=PASS; HOST_ACL_PROVISIONING_REQUIRED",
);
