import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const run = (args, input) => {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 4 * 1024 ** 2,
  });
  if (result.status !== 0)
    throw new Error(`ISOLATED_RUNTIME_SECURITY_FAILED: ${result.stderr}`);
  return result.stdout;
};
const root = "node_modules/next/dist/compiled";
const hashes = {};
for (const file of fs.readdirSync(path.join(root, "next-server")))
  if (file.endsWith(".runtime.prod.js"))
    hashes[`next-server/${file}`] = createHash("sha256")
      .update(fs.readFileSync(path.join(root, "next-server", file)))
      .digest("hex");
for (const name of ["react-server-dom-webpack", "react-server-dom-turbopack"])
  for (const file of fs.readdirSync(path.join(root, name, "cjs")))
    if (file.endsWith(".production.js")) {
      const relative = `${name}/cjs/${file}`;
      hashes[relative] = createHash("sha256")
        .update(fs.readFileSync(path.join(root, relative)))
        .digest("hex");
    }
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const expected = {
  hashes,
  nextIntegrity: lock.packages["node_modules/next"].integrity,
  configBundle: Object.fromEntries(
    ["index.cjs", "package.json"].map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, "zod", file)))
        .digest("hex"),
    ]),
  ),
};
const images = process.argv.slice(2);
if (images.length !== 0 && images.length !== 2)
  throw Error("SUPPLY_BOTH_ISOLATED_RUNTIME_AND_MAINTENANCE_IMAGES");
const probe = fs.readFileSync("scripts/ci/runtime-security-probe.mjs", "utf8");
const reports = [];
for (const [kind, image] of [
  ["runtime", images[0] ?? "recipes:readiness"],
  ["maintenance", images[1] ?? "recipes:readiness-maintenance"],
]) {
  const user = run([
    "image",
    "inspect",
    "--format",
    "{{.Config.User}}",
    image,
  ]).trim();
  const imageId = run([
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]).trim();
  if (kind === "runtime" && user !== "10001:10001")
    throw Error("RUNTIME_USER_CHANGED");
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=32m",
  ];
  if (kind === "maintenance") args.push("--user", "10001:10001");
  args.push(
    "--entrypoint",
    "node",
    "-i",
    image,
    "--input-type=module",
    "-",
    kind,
  );
  const output = run(
    args,
    `const expected = ${JSON.stringify(expected)};\n${probe}`,
  );
  reports.push(JSON.parse(output));
  console.log(JSON.stringify({ imageId, kind }));
  console.log(output.trim());
}
if (
  JSON.stringify(reports[0].nativeLibraries) !==
  JSON.stringify(reports[1].nativeLibraries)
)
  throw Error("RUNTIME_MAINTENANCE_NATIVE_BINARY_MISMATCH");
if (!reports[1].native.rsvg) throw Error("MISSING_NATIVE_REFERENCE_METADATA");
console.log(
  JSON.stringify({
    gate: "NATIVE_LIBRARY_IDENTITY_PASS",
    rsvg: reports[1].native.rsvg,
    evidence:
      "runtime native binary SHA256 equals maintenance binary with full component metadata",
  }),
);
