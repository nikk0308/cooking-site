import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { run } from "../../scripts/backup/archive";
it("actual storeImage rename preserves the narrow reader ACL across distinct Linux UIDs", async () => {
  if (process.platform !== "linux" || !process.env.MEDIA_PERMISSION_TEST_IMAGE)
    throw new Error("MANDATORY_LINUX_ACL_FIXTURE_REQUIRED");
  const name = "culinote-media-acl-" + randomUUID();
  let created = false;
  const exec = (uid: number, script: string) =>
    run("docker", [
      "exec",
      "--user",
      `${uid}:${uid}`,
      name,
      "node",
      "--input-type=module",
      "-e",
      script,
    ]);
  try {
    await run("docker", [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      "com.culinote.fixture=media-acl",
      "--user",
      "10001:10001",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--tmpfs",
      "/media:rw,nosuid,nodev,size=16m,mode=0700,uid=10001,gid=10001",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=32m,mode=1777",
      process.env.MEDIA_PERMISSION_TEST_IMAGE,
    ]);
    created = true;
    expect(
      await run("docker", [
        "exec",
        "--user",
        "10001:10001",
        name,
        "node",
        "--import",
        "tsx",
        "tests/media-permissions/writer.ts",
      ]),
    ).toContain("OWNER_WRITE_READ_HASH_RENAME_ACL=PASS");
    const prelude = `import {readFile,open} from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';const r=JSON.parse(await readFile('/tmp/media-result.json','utf8'));`;
    await exec(
      10002,
      prelude +
        `for(const k of [r.published,r.draft]){const b=await readFile('/media/'+k);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);await assert.rejects(open('/media/'+k,'r+'),{code:'EACCES'});}await assert.rejects(readFile('/media/unconfigured/'+r.unconfigured),{code:'EACCES'});`,
    );
    await exec(
      10003,
      prelude +
        `for(const k of [r.published,r.draft])await assert.rejects(readFile('/media/'+k),{code:'EACCES'});`,
    );
    console.log(
      "ACTUAL_CROSS_UID_READER_ISOLATION=PASS; ABSENT_HOST_ACL_DENIED_EXPECTED",
    );
  } finally {
    if (created) {
      expect(
        await run("docker", [
          "inspect",
          "--format",
          '{{index .Config.Labels "com.culinote.fixture"}}',
          name,
        ]),
      ).toBe("media-acl");
      await run("docker", ["rm", "--force", name]);
    }
  }
}, 60000);
