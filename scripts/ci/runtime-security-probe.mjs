/* Runs only inside disposable read-only, network-disabled Docker images. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const kind = process.argv[2];
assert.equal(process.version, "v24.20.0");
assert.equal(process.getuid(), 10001);
const minimum = {
  next: [16, 4, 1],
  react: [19, 2, 9],
  "react-dom": [19, 2, 9],
  sharp: [0, 35, 5],
  zod: [4, 6, 6],
  "source-map-js": [1, 2, 2],
};
const packages = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && entry.name === "package.json") {
      const p = JSON.parse(fs.readFileSync(file, "utf8"));
      if (minimum[p.name]) {
        const actual = p.version.split(".").map(Number),
          min = minimum[p.name];
        assert.equal(actual.length, 3);
        assert(actual.every(Number.isInteger));
        assert(
          actual[0] > min[0] ||
            (actual[0] === min[0] &&
              (actual[1] > min[1] ||
                (actual[1] === min[1] && actual[2] >= min[2]))),
          `UNPATCHED_PACKAGE:${p.name}`,
        );
        packages.push({
          name: p.name,
          version: p.version,
          path: path.relative("/app", file),
        });
      }
      if (kind === "runtime")
        assert(
          !["vitest", "vite", "drizzle-kit"].includes(p.name),
          "DEV_TOOL_IN_RUNTIME",
        );
    }
  }
}
walk("/app/node_modules");
for (const name of ["next", "react", "react-dom", "sharp"])
  assert(
    packages.some((p) => p.name === name),
    `MISSING_RUNTIME_PACKAGE:${name}`,
  );
let rscFiles = 0;
for (const [relative, hash] of Object.entries(expected.hashes)) {
  const file = path.join("/app/node_modules/next/dist/compiled", relative);
  if (fs.existsSync(file)) {
    assert.equal(
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      hash,
      "VENDORED_RSC_CONTENT_DRIFT",
    );
    rscFiles++;
  }
}
assert(rscFiles > 0, "MISSING_VENDORED_RSC_EVIDENCE");
const { default: sharp } = await import("/app/node_modules/sharp/lib/index.js");
const rsvg = sharp.versions.rsvg.split(".").map(Number);
assert(
  rsvg[0] > 2 ||
    (rsvg[0] === 2 && (rsvg[1] > 63 || (rsvg[1] === 63 && rsvg[2] >= 2))),
  "UNPATCHED_LIBRSVG",
);
sharp.block({ operation: ["VipsForeignLoadSvg"] });
(async () => {
  await assert.rejects(
    sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      ),
    ).metadata(),
    /blocked|unsupported/i,
  );
  for (const format of ["jpeg", "png", "webp"]) {
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      [format]()
      .toBuffer();
    assert.equal((await sharp(bytes).metadata()).format, format);
  }
  const elf = fs.readFileSync(process.execPath).readUInt16LE(16);
  console.log(
    JSON.stringify({
      gate: "BUILT_RUNTIME_SECURITY_PASS",
      kind,
      node: process.version,
      uid: process.getuid(),
      arch: process.arch,
      glibc: process.report.getReport().header.glibcVersionRuntime,
      nodeElfType: elf,
      nodePIE: elf === 3,
      packages,
      native: sharp.versions,
      rscFiles,
      nextIntegrity: expected.nextIntegrity,
      svgLoaderBlocked: true,
    }),
  );
})().catch(() => {
  console.error("BUILT_RUNTIME_SECURITY_REJECTED");
  process.exitCode = 1;
});
