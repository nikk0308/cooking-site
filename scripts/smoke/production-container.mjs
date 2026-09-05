import { spawnSync } from "node:child_process";
const run = (...args) => {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`docker ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const app = run("compose", "-f", "compose.production.yaml", "ps", "-q", "app");
if (!app) throw new Error("production app container is not running");
const inspect = JSON.parse(run("inspect", app))[0];
if (inspect.Config.User !== "10001:10001")
  throw new Error(`unexpected user ${inspect.Config.User}`);
if (!inspect.HostConfig.ReadonlyRootfs)
  throw new Error("root filesystem is not read-only");
if (!inspect.HostConfig.SecurityOpt?.includes("no-new-privileges:true"))
  throw new Error("no-new-privileges is missing");
if (inspect.HostConfig.CapDrop?.[0] !== "ALL")
  throw new Error("capabilities are not dropped");
run(
  "exec",
  app,
  "sh",
  "-c",
  "test $(id -u) -ne 0 && touch /tmp/recipes-smoke && touch /app/.next/cache/recipes-smoke",
);
const denied = spawnSync(
  "docker",
  ["exec", app, "sh", "-c", "touch /app/test-write"],
  {},
);
if (denied.status === 0)
  throw new Error("arbitrary /app write unexpectedly succeeded");
for (const path of ["/", "/api/health/live", "/api/health/ready"]) {
  const response = await fetch(`http://127.0.0.1:3200${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
}
const html = await (await fetch("http://127.0.0.1:3200/")).text();
const encoded = html
  .match(/src="([^\"]*_next\/image\?url=[^\"]+)"/)?.[1]
  ?.replaceAll("&amp;", "&");
if (!encoded) throw new Error("optimized image URL not found");
for (let i = 0; i < 2; i++) {
  const response = await fetch(new URL(encoded, "http://127.0.0.1:3200"));
  if (!response.ok)
    throw new Error(`image optimization returned ${response.status}`);
}
console.log(
  "container security, health, rendering, and image optimization smoke passed",
);
