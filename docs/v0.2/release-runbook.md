# v0.2 release runbook — NOT authorization to execute

The [Phase 6.8 closeout](phase-6.8-closeout.md) accepts source-level readiness;
this production sequence remains unexecuted Phase 7 work. The current-v0.1 source
security exposure and urgent separate hotfix consideration are recorded there.
PR #14 patches reviewed source, not production. No SHA/image/policy is frozen.

All production writes, tooling installation, migrations, app replacement and
rollback require a separate owner-approved release. Engineering readiness changes none of
them. Execute only from a clean exact reviewed Git commit and locked tool
dependencies. Do not use moving branch tags as release inputs.

## Gate 0: signed-off release record

Record RELEASE_SHA, TOOL_SHA, OLD_SHA, actual old/new immutable image digests,
PostgreSQL version, Compose/config backup locations, operator, maintenance window,
test/CI URLs, owner approval and rollback recovery ID. The record must have no
credentials. **STOP** on missing approval, failed CI, dirty source, unknown image,
unverified isolated upgrade/restore, or missing previous image/config.

Release-time checks (separately authorized): Culinote HTTPS/live/ready/PostgreSQL, App Architector
HTTPS/health, local/offsite/watchdog last success and active timers, free space,
full remote COMPLETE/checksum status, GC references and protected point
`20261027T155249Z-012c8349-1a6e2ddc5110`. Readiness calls create a temporary media probe and are not read-only.
Actual live values must be obtained at
release time; source inspection in 6.8A is not current health evidence.

## Gate 1: recovery and bridge before migration

Use the prepared [bridge architecture](backup-bridge-architecture.md), inactive
unit proposals, [transition rehearsal/final freeze](backup-bridge-rehearsal.md)
and [rollback artifact procedure](rollback-artifact-preservation.md). They are
reviewed source, not installed service compatibility evidence. Package version is already 0.2.0. Freeze exact final TOOL_SHA separately
from RELEASE_SHA; historical v0.1 HOTFIX images/policies are not v0.2 artifacts.

1. Before **any** release checkpoint/upload, gate the exact recipes legacy backup
   and offsite timers/triggers and freeze Culinote media/catalog writes under
   the approved maintenance procedure. Let
   existing jobs finish and establish quiescence; changing config does not stop
   an already-running uploader/GC. Preserve current ACK/state after quiescence,
   including the existing lock inodes. Never unlink/recreate live lock files.
   With separate mutation approval, set legacy and replacement offsite private
   config `deletion_enabled` to JSON **false**, remove no recovery material, and
   verify effective configuration and a controlled `DISABLED` result with zero
   deletes. There is no assumed standalone GC timer: installed GC is called by
   the uploader. Keep destructive GC disabled through release and rollback.
   **STOP** for any active unknown writer, failed drain, enabled deletion, missing
   protected references or unknown lock ownership. `DISABLED` is a skip, not GC
   success, backup success or a restore proof; normal capture/upload may proceed.
   Do not resume legacy upload schedules against new schema or a new runtime.
   Capture/verify the exact pre-migration point only after the compatible bridge
   below is accepted. Its ID, app/media identity and remote COMPLETE must agree;
   owner-assisted isolated restore remains mandatory, without exporting age keys.
2. Generate v0.1/v0.2 reference inventories on isolated databases using the exact
   production PG/extension versions and approved migrations. Commands are in
   [backup inventory](backup-v02-inventory.md). Compare actual old schema to its
   reference; do not approve unexpected live drift.
3. Review the three-pair policy (old app/old schema, old app/new schema, new
   app/new schema). TOOL_SHA must match the clean tool checkout; validate the
   backup source, Node 24.20/tsx, broker-only Docker proxy and disk permissions on the
   host before wiring it. The existing Python container may lack these tools:
   **STOP** until an explicit reviewed execution environment is provisioned.
4. Stage the reviewed bridge as a separate private tool checkout. After separate
   approval, wire the unprivileged local backup service through the reviewed
   `bridge.py` wrapper and dedicated broker to `cli.ts --mode capture` with
   explicit database-env/container/media/destination/version and policy. Preserve
   current service lock, independent timer/success reporting, output ownership,
   free-space gate and backup-directory convention. Do not enable a v0.2-only
   guard on legacy backups: first create/verify a bridge v0.1 complete snapshot,
   then activate the prepared offsite validation environment
   `CULINOTE_BACKUP_RELEASE_SOURCE` and `CULINOTE_BACKUP_RELEASE_POLICY` pointing
   to that immutable checkout/policy. Run validation before service acceptance.
   Exact live unit changes need their own reviewed diff; none are installed here.
5. Confirm normal local/offsite backup success with the bridge under v0.1 and
   watchdog success. **STOP** if the source SHA binding or inventory fails.
   Preserve age encryption, credential delivery and recovery proof. Restore only
   approved compatible schedules; destructive GC stays disabled. The deliberate
   deletion disable above is required, not permission to alter retention policy.

## Gate 2: controlled Culinote write freeze and upgrade

1. Keep Culinote writes frozen from the first bridge baseline through acceptance; do not stop shared
   Docker/PostgreSQL or App Architector. Preserve final pre-upgrade point. Drain
   any Culinote backup/upload operations using existing workflow locks; never
   bypass locks. Legacy triggers must already be gated as above. Protect required recovery material using
   existing reference/proof rules. A fifth protected point is a warning, not
   permission to delete it.
2. The new app queries new catalog columns, so **migrate before replacing the app**
   while requests remain frozen. Use approved maintenance image by digest:

   `compose.production.yaml` has **no maintenance service**. Do not run the
   previous `compose run maintenance` example. Prepare/review a private,
   release-specific override with service `maintenance`, approved immutable image
   `RECIPES_MAINTENANCE_IMAGE` (digest), explicit existing recipes database network,
   private credential delivery and migration working directory. It must neither
   replace PostgreSQL nor inherit app startup/dependency actions. Then use:

   ```sh
   docker compose --project-name recipes --env-file "$RELEASE_ENV" \
     -f "$PRESERVED_COMPOSE" -f "$APPROVED_MAINTENANCE_OVERRIDE" \
     run --rm --no-deps maintenance npm run db:migrate
   ```

   These names are required approved release-record paths, not executable defaults.
   Offline-render with synthetic credentials first; do not export real Compose
   interpolation/environment to logs. **STOP** if the override, network, image
   identity, credential contract or migration entrypoint is unverified.

   Execute only with the approved Culinote Compose project/config and explicit
   immutable maintenance image. Check exit code, ledger hashes, 14 tables, indexes,
   extension, six triggers and full inventory. No manual ledger edits.

3. Capture a full v0.2 backup with the bridge's old-app/new-schema approved pair
   (explicit `--version v0.2`) before deployment. Validate locally. Keep traffic
   frozen: the ordinary offsite uploader binds source_sha to current runtime.
4. Replace only the Culinote app with the approved new runtime image. Confirm its
   revision label equals RELEASE_SHA. The next capture must select v0.2 inventory
   and exact new-app/new-schema rule; new-app/old-schema is forbidden.
5. Capture/validate/upload a new full v0.2 point while the new runtime SHA is
   current. Check remote ciphertext hashes/COMPLETE, watchdog and GC protected
   references. A stale old-runtime backup must not be uploaded under the new SHA.
   Do not accept a release while the daily backup is silently broken.

The explicit inventory version in service wiring must transition under the
Culinote maintenance/backup lock immediately after successful migration; do not
let a nine-table validator run against the new schema. Any failed step is STOP,
not a reason to disable guards. No application traffic resumes before Gate 3.

## Gate 3: acceptance and owner proof

Verify public publication guards/scaling/media/nutrition, admin login/search and
synthetic disposable importer; browser local CRUD/photos/favorites/shopping,
explicit legacy reconciliation, portable backup and no private writes; readiness,
logs without secrets, backup/offsite/watchdog/timers and App Architector health.
Use disposable browser data, never a real user's profile.

Owner performs offline decryption plus isolated full v0.2 restore following
[recovery validation](recovery-validation.md). Until that proof is recorded,
preserve the original recovery-verified snapshot and mark this gate pending.
Only an separately reviewed proof update can replace protected recovery material.
Record acceptance and lift write freeze only according to the approved release
decision; this preparation does not grant approval.

## Stop / rollback

Missing schema objects, bad ledger, incompatible SHA, failed readiness/media,
failed backup/offsite integrity, unauthorized private writes or shared-app
regression are STOP criteria. Keep writes frozen, preserve evidence, and use
[rollback matrix](rollback-plan.md). App-only rollback retains schema and the
v0.2 inventory bridge. Full DB restore needs separate authorization and a stated
post-recovery-point data-loss window. Never run destructive down-migrations.

## Transition-specific STOP conditions and preservation

- OLD writes media with mode 0600. A default ACL alone does not make new OLD
  files readable by the unprivileged bridge. Freeze uploads before the bridge
  baseline, enumerate DB-referenced media and approve a narrow existing-file read
  grant. Verify actual access as the runner. Keep writes frozen until the v0.2
  0640 writer plus default reader ACL is accepted. Do not recursively broaden
  permissions or add Docker authority to the runner. App-only rollback to OLD
  restores this 0600 constraint: keep uploads/catalog writes gated.
- Quiescence includes broker children and daemon-owned PostgreSQL dump workers;
  an inactive oneshot or released client PID alone is insufficient. Require no
  active capture/upload, no target dump workers and acquisition of the original
  capture/upload locks before state cut, migration or app switch. Do not stop the
  shared Docker daemon, PostgreSQL or any App Architector resource.
- Preserve exact OLD image/config privately and durably, then exact-byte verify
  and rehearse its isolated restoration. Mere local image existence and a source
  rebuild are insufficient. Preserve original snapshots/ACK; never relabel them.
- Keep historical ledger bytes (including CRLF 0000/0001) unchanged. Require the
  exact approved OLD/old, OLD/new and NEW/new pairs; reject NEW/old. Switch the
  bridge inventory under the held release locks immediately after migration.
- New upload receipts bind COMPLETE with `marker_sha256`; legacy receipts are
  readable but do not acquire a trusted historical digest. Retain the protected
  point until an owner-assisted current restore establishes a trust anchor.
  Consistently replaced historical references are not disproved by consistency
  checks. A historical GC record `deleted=1` identifies neither current loss nor
  recoverability: verify remote inventory and decrypt/restore separately.
- Preserve https://culinote.top and browser storage names. Never clear IndexedDB,
  localStorage or use Clear-Site-Data to fix an upgrade/rollback. Offer portable
  export, close old tabs before import, preserve v1 bytes and v2 state. Server
  backups do not include browser-local recipes/photos/favorites/shopping.
- App Architector is outside the mutation scope. Use explicit recipes paths,
  project, containers and networks; no host-wide cleanup, daemon restart, shared
  proxy/DNS change or shared-volume operation. Stop on uncertain ownership.
