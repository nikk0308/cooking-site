import { spawnSync } from "node:child_process";
const run = (...args) => {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error("Docker smoke command failed");
  return r.stdout.trim();
};
const app = run("compose", "-f", "compose.production.yaml", "ps", "-q", "app");
const inspect = JSON.parse(run("inspect", app))[0];
if (
  inspect.Config.User !== "10001:10001" ||
  !inspect.HostConfig.ReadonlyRootfs ||
  !inspect.HostConfig.SecurityOpt?.includes("no-new-privileges:true") ||
  !inspect.HostConfig.CapDrop?.includes("ALL")
)
  throw new Error("Runtime security contract failed");
run(
  "exec",
  app,
  "node",
  "-e",
  "const fs=require('fs');for(const p of ['/tmp/recipes-smoke','/app/.next/cache/recipes-smoke','/app/media/recipes-smoke']){fs.writeFileSync(p,'test');fs.unlinkSync(p)}",
);
const denied = spawnSync(
  "docker",
  [
    "exec",
    app,
    "node",
    "-e",
    "require('fs').writeFileSync('/app/test-write','test')",
  ],
  { stdio: "pipe" },
);
if (denied.status === 0) throw new Error("Arbitrary /app write allowed");
for (const route of [
  "/",
  "/recipes/syrniki",
  "/api/health/live",
  "/api/health/ready",
]) {
  const r = await fetch("http://127.0.0.1:3200" + route);
  if (!r.ok) throw new Error(route + " failed");
}
const html = await (
  await fetch("http://127.0.0.1:3200/recipes/syrniki")
).text();
const key = html.match(/src="(\/media\/[a-f0-9-]+\.webp)"/)?.[1];
if (!key) throw new Error("Cover missing");
const image = await fetch("http://127.0.0.1:3200" + key);
if (!image.ok || image.headers.get("content-type") !== "image/webp")
  throw new Error("Media serving failed");
console.log(
  "PASS: UID/GID, read-only root, tmp/cache/media writes, arbitrary write rejection, public catalog/recipe, health, media",
);
