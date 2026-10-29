# v0.2 rollback decision matrix

No automatic production rollback is authorized. There are no verified destructive
down-migrations for 0002/0003. Never remove new tables or edit the ledger to mimic
v0.1. Every production action below requires separate owner approval.

| Failure / detection                         | App-only rollback                                                               | Full restoration                                                                                                               | Loss exposure / action / verification                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| New app readiness/UI fails, DB valid        | Possible only with tested exact previous image/config and v0.2 inventory bridge | Not normally needed                                                                                                            | Stop writes, restore previous app; keep schema and v0.2 backup validation; verify public/admin/media/readiness            |
| Upgrade transaction fails                   | Keep old app and old-schema approved pair; confirm actual ledger/schema         | If partial/unverified state, investigate before writes                                                                         | Do not mark migration successful; compare pre-release point and inventory                                                 |
| Wrong data/schema after committed migration | App rollback does not repair data                                               | Restore verified pre-migration dump and matching media into isolated target first; authorize production replacement separately | Downtime required; all writes since exact recovery point may be lost; reconcile/export needed before replacement          |
| Backup guard/inventory mismatch             | Stop release; do not weaken guard                                               | Only if corruption requires it                                                                                                 | Preserve last valid local/offsite point; fix approved policy/tools and validate a new complete snapshot before acceptance |
| Offsite/owner restore failure               | Stop acceptance, preserve recovery material                                     | Depends on failed integrity check                                                                                              | Do not replace protected point or force GC to meet four-point target                                                      |
| Browser incompatibility                     | Old UI may expose only v1 basket                                                | Server restore cannot recover browser data                                                                                     | Export first when possible, preserve IndexedDB and v1 bytes, explain v2 state is retained but not represented in v0.1 UI  |

## Compatibility boundary

CI rebuilds exact old application sources
`4f4807aa90c1bb52d6faaec5121f7c27bdada464` with the same Node version pinned by
digest, and tests that runtime against a full restored v0.2 database. It verifies
public reads/media, admin login and an old ingredient update preserving new
category/provenance/source identity. This proves tested source compatibility,
not byte identity with the installed production image. Record and preserve the
actual previous image digest, environment/configuration and media before release.

After app-only rollback **continue using full v0.2 inventory**, with the exact
old-SHA/new-schema pair. The old nine-table backup would omit recovery material.
Freeze catalog modifications while operating the old administration interface,
which cannot manage new import/provenance semantics. Use rollback as temporary
service recovery, not a supported long-term v0.2 admin workflow.

## Full database recovery procedure

Record the exact pre-release snapshot ID, application digest, schema hash, tool
policy, media manifest and checksum report in the separately approved release
record. Stop Culinote writes only; App Architector is outside scope. First restore
to a new isolated empty database/media directory, verify inventory/FKs/UUIDs and
application readiness, then obtain explicit approval for production database/
media switch. Never restore over a live PostgreSQL database. Record downtime,
post-point lost/reconciled writes and final health/backup evidence before reopening.

Browser recipes/photos/favorites/shopping are not in server backups. Do not run
clear-site-data, delete IndexedDB or overwrite v2 from old v1 on rollback. Returning
to v0.2 may require explicit LEGACY_CHANGED reconciliation for old-tab writes.
