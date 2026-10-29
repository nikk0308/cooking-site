import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
const inputs = JSON.parse(
  readFileSync(new URL("./build-inputs.json", import.meta.url), "utf8"),
);
const root = mkdtempSync(path.join(os.tmpdir(), "culinote-rollback-build-")),
  source = path.join(root, "source");
mkdirSync(source);
const run = (args) => {
  const r = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
  if (r.status !== 0) throw new Error("Isolated rollback rebuild failed");
};
try {
  run([
    "git",
    "archive",
    "--format=tar",
    `--output=${path.join(root, "source.tar")}`,
    inputs.inspectedV01GuardSha,
  ]);
  run(["tar", "-xf", path.join(root, "source.tar"), "-C", source]);
  const file = path.join(source, "Dockerfile"),
    original = readFileSync(file, "utf8");
  if (!original.includes("node:24.20.0-bookworm-slim"))
    throw new Error("Unreviewed v0.1 base image");
  // Application sources are exactly the inspected deployed SHA. Only the same
  // Node base reference is locked to its reviewed digest for this test rebuild.
  writeFileSync(
    file,
    original.replaceAll("node:24.20.0-bookworm-slim", inputs.nodeImage),
  );
  run([
    "docker",
    "build",
    "--tag",
    "recipes:rollback-v01",
    "--label",
    `org.opencontainers.image.revision=${inputs.inspectedV01GuardSha}`,
    source,
  ]);
  console.log(`V01_SOURCE_REBUILD=PASS source=${inputs.inspectedV01GuardSha}`);
} finally {
  const resolved = realpathSync(root);
  if (
    path.dirname(resolved) !== realpathSync(os.tmpdir()) ||
    !path.basename(resolved).startsWith("culinote-rollback-build-")
  )
    throw new Error("Unsafe cleanup target");
  rmSync(resolved, { recursive: true, force: true });
}
