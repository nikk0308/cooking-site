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
