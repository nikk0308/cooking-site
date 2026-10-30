# Versioned backup contract

Prepared source: `scripts/backup/{inventory.sql,inventory.ts,guard.ts,archive.ts,cli.ts,prepare.ts}`.
Not installed on production. Read-only inspection of the installed v0.1
backup script confirmed a nine-table inventory and a hardcoded deployed SHA
`4f4807aa90c1bb52d6faaec5121f7c27bdada464`. This is source inspection, not a
new verification of actual runtime/backup health.

## Inventory format 2

v0.1: admin_users, admin_sessions, ingredients, ingredient_nutrition, units,
recipes, recipe_ingredients, recipe_steps, media.
v0.2 additionally: ingredient_categories, ingredient_aliases,
catalog_source_records, catalog_import_runs, catalog_revision.

Inventory captures all column definitions (including category_id, generated
normalization expressions, precision/scale and nutrition provenance), validated
constraints/FKs, index definitions, enums, extension names/versions including
pg_trgm, non-extension public function definitions including
`bump_catalog_revision()`, all six enabled statement revision triggers, full
unit metadata and the Drizzle migration ledger. Per-table row count and SHA256
cover raw PostgreSQL JSON text without parsing NUMERIC into JavaScript numbers.
Rows are streamed in bounded cursor batches, ordered with C collation. Database
content is not printed. Inventory is private backup metadata.

The schema fingerprint excludes data counts/hashes and binds exact schema
metadata. PostgreSQL 18 pg_dump rewrites two equivalent CHECK expressions;
comparison recognizes only the exact whitelisted equivalent source-kind/mode
forms. It does not ignore arbitrary CHECK differences. Raw DDL is retained and
invalid enum updates are tested against the restored database.

## Snapshot and integrity

An exported repeatable-read snapshot binds inventory, pg_dump and media rows.
The container's PostgreSQL system identifier must match the SQL connection.
Only referenced immutable UUID.webp media (including drafts) are archived, with
size/content checks. Restore verifies regular archive entries, no links or
unknown paths, exact media set, hashes and full restored inventory.

The existing six SHA256SUMS entries remain: recipes.dump, media.tar.gz,
manifest.json, database-state.json, media-manifest.json, restore-list.txt.
Manifest format remains 1 with inventory_version, schema_hash, backup_tool_sha
added; source_sha remains the actual application SHA. COMPLETE is fsynced last
and never published after a failed capture. No plaintext offsite format is added.
Existing age packaging, three ciphertext objects, remote COMPLETE and GC are
unchanged. The prepared offsite gate validates new backups through the versioned
CLI and fails closed if its policy/source dependencies are missing.

## Explicit tool interface

Run from a clean checkout of the reviewed tool SHA with its locked dependencies.
All outputs must be in a private directory outside the repository. Files use
0600, directories 0700 on Linux; the operator must enforce Windows ACLs.
`BACKUP_TEST_URL` below is supplied by the operator for an isolated target only;
there is no DATABASE_URL fallback.

```sh
npx tsx scripts/backup/prepare.ts --mode inventory --database-env BACKUP_TEST_URL --version v0.1 --output /private/reference-v01.json
# Repeat on a second isolated database after all migrations:
npx tsx scripts/backup/prepare.ts --mode inventory --database-env BACKUP_UPGRADED_URL --version v0.2 --output /private/reference-v02.json
npx tsx scripts/backup/prepare.ts --mode policy --v01 /private/reference-v01.json --v02 /private/reference-v02.json --old-sha "$OLD_SHA" --new-sha "$RELEASE_SHA" --output /private/policy.json
npx tsx scripts/backup/cli.ts --mode capture --policy /private/policy.json --directory /private/new-snapshot --database-env BACKUP_TEST_URL --pg-container "$PG_CONTAINER" --app-container "$APP_CONTAINER" --media /private/source-media --version v0.2 --runtime-sha "$RELEASE_SHA" --tool-sha "$TOOL_SHA"
npx tsx scripts/backup/cli.ts --mode validate --policy /private/policy.json --directory /private/new-snapshot --runtime-sha "$RELEASE_SHA"
```

Reference generation reads only; it does not approve or deploy a policy. Review
the two schema fingerprints and all three exact pairs. Only old-runtime/old-schema,
old-runtime/new-schema (application rollback), and new-runtime/new-schema are
allowed. New-runtime/old-schema, unknown SHA, incomplete inventory or mismatched
tool SHA fail. Changing the protected recovery point is not a capability of this
tool. Full real-host compatibility and service wiring remain release gates.

Phase 6.8B.1 prepares the [private host environment and broker](backup-bridge-architecture.md)
and [five-state rehearsal/final freeze](backup-bridge-rehearsal.md). Production
automation must use the reviewed bridge entrypoint, not an npx invocation that
could install missing tools. The examples above are isolated, already provisioned
source commands only. Nothing is installed on the live server.
