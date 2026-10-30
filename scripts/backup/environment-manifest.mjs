import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const [root, lock] = process.argv.slice(2);
if (process.version !== "v24.20.0" || !root || !lock)
  throw new Error("EXPLICIT_PINNED_ENVIRONMENT_REQUIRED");
const deps = path.join(root, "node_modules"),
  entries = [];
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else entries.push(full);
  }
}
walk(deps);
entries.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
const tree = createHash("sha256");
for (const full of entries) {
  tree.update(path.relative(deps, full) + "\0");
  if (fs.lstatSync(full).isSymbolicLink()) {
    if (!fs.realpathSync(full).startsWith(deps + path.sep))
      throw new Error("EXTERNAL_DEPENDENCY_LINK");
    tree.update("L" + fs.readlinkSync(full) + "\0");
  } else tree.update("F" + hash(fs.readFileSync(full)) + "\0");
}
const inputs = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL("./build-inputs.json", import.meta.url)),
  ),
);
fs.writeFileSync(
  path.join(root, "environment.json"),
  JSON.stringify({
    format: 1,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    baseImage: inputs.nodeImage,
    nodeSha256: hash(fs.readFileSync(path.join(root, "node"))),
    lockfileSha256: hash(fs.readFileSync(lock)),
    dependenciesSha256: tree.digest("hex"),
  }),
  { mode: 0o600 },
);
