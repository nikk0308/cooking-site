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

Read-only health gates: Culinote HTTPS/live/ready/PostgreSQL, App Architector
HTTPS/health, local/offsite/watchdog last success and active timers, free space,
full remote COMPLETE/checksum status, GC references and protected point
`20261027T155249Z-012c8349-1a6e2ddc5110`. Actual live values must be obtained at
release time; source inspection in 6.8A is not current health evidence.

## Gate 1: recovery and bridge before migration

Use the prepared [bridge architecture](backup-bridge-architecture.md), inactive
unit proposals, [transition rehearsal/final freeze](backup-bridge-rehearsal.md)
and [rollback artifact procedure](rollback-artifact-preservation.md). They are
reviewed source, not installed service compatibility evidence. Resolve the
package-version decision and exact final TOOL_SHA separately from RELEASE_SHA.

1. Capture/verify a pre-migration v0.1 backup and encrypted remote COMPLETE using
   the currently working system. Record its exact ID and matching app/media.
   Owner-assisted restore is a separate gate; never expose the private age key.
2. Generate v0.1/v0.2 reference inventories on isolated databases using the exact
   production PG/extension versions and approved migrations. Commands are in
   [backup inventory](backup-v02-inventory.md). Compare actual old schema to its
   reference; do not approve unexpected live drift.
3. Review the three-pair policy (old app/old schema, old app/new schema, new
   app/new schema). TOOL_SHA must match the clean tool checkout; validate the
   backup source, Node 24.20/tsx, Docker CLI access and disk permissions on the
   host before wiring it. The existing Python container may lack these tools:
   **STOP** until an explicit reviewed execution environment is provisioned.
4. Stage the reviewed bridge as a separate private tool checkout. After separate
   approval, wire local backup service entrypoint to `cli.ts --mode capture` with
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
   Do not change age encryption, credentials, timers, GC rules or recovery proof.

## Gate 2: controlled Culinote write freeze and upgrade

1. Obtain approval to freeze Culinote writes/serve maintenance; do not stop shared
   Docker/PostgreSQL or App Architector. Preserve final pre-upgrade point. Drain
   any Culinote backup/upload operations using existing workflow locks; never
   bypass locks or change schedules. Protect required recovery material using
   existing reference/proof rules. A fifth protected point is a warning, not
   permission to delete it.
2. The new app queries new catalog columns, so **migrate before replacing the app**
   while requests remain frozen. Use approved maintenance image by digest:

   ```sh
   docker compose -f compose.production.yaml run --rm maintenance npm run db:migrate
   ```

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
