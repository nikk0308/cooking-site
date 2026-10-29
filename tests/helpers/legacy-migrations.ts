import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
export async function legacyMigrations(count = 2) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "culinote-release-migrations-"),
  );
  await mkdir(path.join(root, "meta"));
  const journal = JSON.parse(
    await readFile("db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.idx < count);
  await writeFile(
    path.join(root, "meta/_journal.json"),
    JSON.stringify(journal),
  );
  for (const e of journal.entries)
    await copyFile(
      `db/migrations/${e.tag}.sql`,
      path.join(root, `${e.tag}.sql`),
    );
  return {
    root,
    async cleanup() {
      const target = await realpath(root);
      if (
        path.dirname(target) !== (await realpath(os.tmpdir())) ||
        !path.basename(target).startsWith("culinote-release-migrations-")
      )
        throw new Error("Unsafe test migration cleanup");
      await rm(target, { recursive: true, force: true });
    },
  };
}
