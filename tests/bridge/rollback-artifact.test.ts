import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { run, fileDigest } from "../../scripts/backup/archive";
import inputs from "../../scripts/backup/build-inputs.json";

it("synthetic exact image and private configuration roundtrip independently of source rebuilds", async () => {
  if (
    process.platform !== "linux" ||
    process.getuid!() === 0 ||
    !process.env.BACKUP_TEST_PG_CONTAINER
  )
    throw new Error("NONROOT_ISOLATED_LINUX_REQUIRED");
  const root = await mkdtemp(
    path.join(os.tmpdir(), "culinote-rollback-artifact-"),
  );
  const token = randomUUID(),
    tag = "culinote-rollback-fixture:" + token;
  let image: string | undefined;
  const script = path.resolve("scripts/backup/rollback_artifact.py");
  try {
    await mkdir(path.join(root, "build"));
    await writeFile(
      path.join(root, "build/Dockerfile"),
      `FROM ${inputs.nodeImage}\nLABEL com.culinote.fixture="${token}"\n`,
    );
    await run("docker", ["build", "--tag", tag, path.join(root, "build")]);
    image = await run("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      tag,
    ]);
    const pgImage = await run("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      process.env.BACKUP_TEST_PG_CONTAINER,
    ]);
    const compose = path.join(root, "synthetic-compose.yaml"),
      env = path.join(root, "synthetic-runtime.env"),
      artifact = path.join(root, "artifact");
    await writeFile(compose, "name: disposable-synthetic-only\n", {
      mode: 0o600,
    });
    await writeFile(
      env,
      "DATABASE_URL=postgresql://synthetic.invalid/not-real-data\n",
      { mode: 0o600 },
    );
    const args = [
      script,
      "preserve",
      "--directory",
      artifact,
      "--image",
      image,
      "--compose",
      compose,
      "--runtime-env",
      env,
      "--media",
      "/synthetic/media",
      "--export-image",
      "--postgres-image",
      pgImage,
    ];
    await expect(run("python3", args)).rejects.toThrow();
    await run("python3", [...args, "--confirm-owner-authorized-preservation"]);
    const recordSha = await fileDigest(path.join(artifact, "artifact.json"));
    await run("python3", [
      script,
      "verify",
      "--directory",
      artifact,
      "--expected-record-sha",
      recordSha,
    ]);
    expect(await readFile(path.join(artifact, "runtime.env"), "utf8")).toBe(
      await readFile(env, "utf8"),
    );
    for (const name of [
      "runtime.env",
      "compose.yaml",
      "image.tar",
      "artifact.json",
      "COMPLETE",
    ])
      expect((await stat(path.join(artifact, name))).mode & 0o077).toBe(0);
    await run("docker", ["image", "rm", "--no-prune", tag]);
    await expect(run("docker", ["image", "inspect", image])).rejects.toThrow();
    await expect(
      run("python3", [
        script,
        "restore-image",
        "--directory",
        artifact,
        "--expected-record-sha",
        "a".repeat(64),
        "--confirm-owner-authorized-preservation",
      ]),
    ).rejects.toThrow();
    await run("python3", [
      script,
      "restore-image",
      "--directory",
      artifact,
      "--expected-record-sha",
      recordSha,
      "--confirm-owner-authorized-preservation",
    ]);
    expect(
      await run("docker", ["image", "inspect", "--format", "{{.Id}}", image]),
    ).toBe(image);
    await writeFile(path.join(artifact, "runtime.env"), "synthetic tampering");
    await expect(
      run("python3", [
        script,
        "verify",
        "--directory",
        artifact,
        "--expected-record-sha",
        recordSha,
      ]),
    ).rejects.toThrow();
    await unlink(path.join(artifact, "COMPLETE"));
    await expect(
      run("python3", [
        script,
        "restore-image",
        "--directory",
        artifact,
        "--expected-record-sha",
        recordSha,
        "--confirm-owner-authorized-preservation",
      ]),
    ).rejects.toThrow();
    console.log(
      "SYNTHETIC_EXACT_IMAGE_CONFIG_PRESERVATION_RESTORE=PASS; ACTUAL_PRODUCTION_IMAGE=NOT_ACQUIRED",
    );
  } finally {
    if (image) {
      try {
        const label = await run("docker", [
          "image",
          "inspect",
          "--format",
          '{{index .Config.Labels "com.culinote.fixture"}}',
          image,
        ]);
        if (label !== token) throw new Error("UNSAFE_FIXTURE_IMAGE_CLEANUP");
        await run("docker", ["image", "rm", "--no-prune", image]);
      } catch (e) {
        if (e instanceof Error && e.message === "UNSAFE_FIXTURE_IMAGE_CLEANUP")
          throw e;
      }
    }
    if (
      path.dirname(root) !== os.tmpdir() ||
      !path.basename(root).startsWith("culinote-rollback-artifact-")
    )
      throw new Error("UNSAFE_FIXTURE_CLEANUP");
    await rm(root, { recursive: true, force: true });
  }
}, 180000);
