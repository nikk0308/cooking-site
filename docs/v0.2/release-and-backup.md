# Release and backup compatibility (future release gate)

Phase 6.4 does not access or migrate production and does not modify backup/GC, services, schedules, credentials or OCI registry. Production remains v0.1. PR review/merge is separate from a release.

Migration 0002 is additive; 0000/0001 SQL and snapshots are immutable. Clean PostgreSQL 18 and v0.1-to-v0.2 upgrades are tested, including recipe/line/step/unit/admin preservation, nutrition defaults and idempotent migration ledger behavior. No existing UUID or FK is replaced. Historical migrations are not a down-migration mechanism.

Before an eventual v0.2 production migration:

1. Under separate authorization, create and verify a compatible pre-migration backup using current v0.1 tooling and retain exact Git SHA/rebuild inputs.
2. Update the backup inventory/STATE_SQL for ingredient_categories, ingredient_aliases, new ingredient fields and nutrition provenance; include migrations, schema/constraints/indexes and unit metadata. Do not change production backup code during foundation development.
3. Coordinate the existing hard-coded local deployed-SHA guard and offsite manifest/runtime SHA checks with the release. Do not bypass the guard or let a release silently disable backups.
4. Test 0002 on a restored isolated copy and validate a full post-migration restore with the compatible inventory. Preserve the previous recovery-verified point until replacement verification succeeds.
5. Only then authorize production migration/deployment. Require local backup, verified offsite COMPLETE and watchdog success for the new release; monitor existing GC protection and warnings.

The owner chose to rebuild OCI images from GitHub rather than archive them. Preserve the exact commit, lockfile, Dockerfiles and toolchain requirements; test rebuildability on the replacement host. A Git commit alone does not guarantee that external registries/dependencies remain available.

Local IndexedDB content is not included in server backups. Phase 6.5 implements user-initiated export/import as the portable recovery path for private browser data; site deployment must not clear/reset browser storage. Export before changing browser profiles/devices. Neither this phase nor merging its PR authorizes production migration/deployment.

Phase 6.6 changes the browser-facing `/basket` to Shopping v2 without another database migration. At a separately authorized release, explain that users must explicitly review/transfer old basket v1 and export the resulting v2 state. Close old tabs where practical; if an old tab writes v1 again, use the explicit reconciliation banner. Internal undo checkpoints and migration receipts are browser-local recovery aids, not part of server backups or portable JSON. Production backup/GC configuration and schedules are unchanged by shopping development.

# Phase 6.7 release inventory additions — future authorization required

Migration 0003 is development/CI-only in this phase; production remains v0.1, with neither 0002 nor 0003 applied. Before a separately authorized v0.2 release, update and verify the backup inventory for all earlier catalog tables plus `catalog_source_records`, `catalog_import_runs`, `catalog_revision`, their keys/checks/FKs, `bump_catalog_revision()` and all six revision triggers, GIN/prefix indexes and the `pg_trgm` extension. Include unit metadata, migration ledger, immutable migrations/snapshots and exact source/lockfile. Verify extension availability/permissions on an isolated restored copy before production approval. Preserve source mappings and audit receipts: losing them breaks reliable import identity/precedence and checkpoint evidence.

Run release-level restore and migration checks, publication/admin/browser regressions, imported UUID use in recipes/shopping and dependency/toolchain rebuilds in Phase 6.8. Backup SHA/inventory guards need separately reviewed updates before deployment; do not silently disable them. Phase 6.7 modifies no production backup jobs, schedules, GC or infrastructure. No production data population is authorized.
