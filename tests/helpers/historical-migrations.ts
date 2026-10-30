import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { legacyMigrations } from "./legacy-migrations";
// Test-only materialization. Never edits tracked SQL or a real migration ledger.
export async function historicalMigrations(count = 4, crlfHistory = true) {
  const fixture = await legacyMigrations(count);
  try {
    const journal = JSON.parse(
      await readFile(path.join(fixture.root, "meta/_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const hashes: string[] = [];
    for (const e of journal.entries) {
      const canonical = execFileSync("git", [
        "show",
        `HEAD:db/migrations/${e.tag}.sql`,
      ]);
      if (canonical.includes(Buffer.from("\r\n")))
        throw new Error("EXPECTED_IMMUTABLE_LF_GIT_INPUT");
      const bytes =
        crlfHistory && e.idx < 2
          ? Buffer.from(canonical.toString("utf8").replaceAll("\n", "\r\n"))
          : canonical;
      hashes.push(createHash("sha256").update(bytes).digest("hex"));
      await writeFile(path.join(fixture.root, e.tag + ".sql"), bytes);
    }
    return { ...fixture, hashes };
  } catch (e) {
    await fixture.cleanup();
    throw e;
  }
}
