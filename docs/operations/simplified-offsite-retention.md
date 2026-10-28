# Culinote simplified offsite retention

Phase 6.3D.6 connects GC to the daily upload workflow. Activation requires both
`private/config.json` with `deletion_enabled: true` and an owner-confirmation
receipt in `state/retention-activation.json`. No credentials or private age
identity belong in these sources or the receipt.

## Policy

- Daily: latest verified backup of each of the two latest available UTC dates.
- Weekly: first verified successful backup of the latest available ISO week, UTC.
- Monthly: first verified successful backup of the latest available month, UTC.
- Missing days/weeks/months do not synthesize snapshots. The first successful
  backup after a boundary establishes that period's point.
- Categories reference the same ciphertext objects when their snapshots overlap.
- Protect the snapshot in the latest successful real owner recovery proof.
  Ciphertext verification alone never replaces that proof.

The normal target is at most four unique snapshots. If the protected restored
snapshot would be a fifth point, GC is blocked until an owner restore validates a
replacement. Protection takes precedence over the size limit. While deletion is
disabled, remote objects continue accumulating regardless of the target policy.

## Layout and integration

Only bucket `culinote-backups`, prefix `culinote/`:

```text
blobs/<snapshot>/{database,media,manifest}.encrypted
daily/<snapshot>/COMPLETE
weekly/<ISO-year>-W<week>/COMPLETE
monthly/<year>-<month>/COMPLETE
```

Period markers are small private JSON references, not additional backup payloads.
Existing monthly markers remain valid. Bootstrap creates missing weekly markers
in chronological order only after verifying all existing ciphertext objects.

The server entrypoint `/opt/docker-stacks/recipes/backup/offsite/offsite.py`
imports `offsite_retention.py`. Successful uploads establish period references,
persist `last-success.json`, release the upload lock and invoke GC. GC reacquires
the same lock, verifies current local/upload binding and rebuilds its plan. Failed
uploads never invoke GC. GC errors are caught and recorded separately so fresh
encrypted backups continue. Watchdog verifies weekly/monthly references and
reports GC warnings without falsely declaring the verified backup failed.
Local backup code and all timer schedules are unchanged.

## GC safety and activation gate

`execute()` defaults to disabled and supports explicit-plan calls. The automatic
`cycle()` is gated by config and the owner receipt, then computes and approves a
fresh plan under the shared lock. The owner authorized future ordinary rotation
under this fixed policy; each normal daily deletion does not need manual approval.
`offsite.py gc` repeats the same cycle without creating a new backup. The normal
daily `offsite.py upload` invokes it only after remote verification and success.

Limited-key access is checked through ListObjectsV2, GetObject and HeadObject in
the expected bucket and managed prefix. GetBucketPolicy/GetBucketAcl are not
required and are never called by retention. Their administrative AccessDenied
does not invalidate successful object access. The plan records these object
checks separately from the owner's independent-writer confirmation. No attempt
is made to enumerate other buckets or claim the key cannot access them; its
account-level scope must be reviewed by the owner without exposing key values.

Before deleting, it acquires the upload lock, validates the current local backup,
checks unchanged recovery proof/upload state, rebuilds the complete plan and
downloads/verifies every referenced ciphertext object. Unknown keys, incomplete
uploads, missing markers, conflicting references, S3 errors and unresolved upload
failure stop the operation.

Obsolete COMPLETE markers are removed before their unreferenced blobs. Before
every deletion, the inventory, references and all remaining ciphertext checksums
are re-read. Retained markers and protected blobs must still be present. The
logical policy is recomputed from the original verified catalog; the remaining
inventory allows only already-confirmed deletions. Each operation receives a new
progress-plan hash binding the current inventory and next key. ETag and byte size
must match the approved inventory.
Every delete is individually confirmed; errors stop further deletes. A partial
failure can leave extra orphan ciphertext, which blocks further planning until
reviewed. There is no blind orphan cleanup or `sync --delete`.

All writers must use the same host lock. GC is not safe with an independently
writing second host or an operator modifying Spaces concurrently; enabling that
architecture requires a distributed concurrency design first. The lock does not
make a sequence of S3 operations transactional.

For initial activation, the owner authorized only an empty fresh plan. An initial
nonempty plan requires separate review. Subsequent normal daily plans are covered
by the approved policy. A protected fifth point blocks the entire GC with
`RECOVERY_REVALIDATION_REQUIRED`; no partial cleanup is performed in this case.

`state/gc-status.json` records enabled/status, timestamps, plan hash, retained
snapshots and planned/deleted counts. Safe `CULINOTE_GC` journal events record
operation keys, progress-plan hashes and results. Watchdog emits
`WATCHDOG_WARNING` for blocked/error/stale GC status. It does not connect external
notifications. A dry-run plan has `dry_run: true`, independent of the active
configuration. Disable GC by setting only `deletion_enabled` to false; daily
uploads continue. Investigate interrupted GC before attempting orphan repair.

## Verification

```powershell
python -B -m unittest discover -s scripts -p test_offsite_retention.py -v
```

Tests use an in-memory S3 implementation; executor deletes only that fixture.
Production dry-run is the existing `offsite.py retention-dry-run` mode; its output
is stored in `state/retention-dry-run.json`, including exact keys, byte sizes,
ETags, protected snapshot and the approval hash. Controlled activation cycles
must preserve the original inventory and delete zero objects with an empty plan.

## Recovery source inventory and activation status

`scripts/culinote_offsite.py` is the versioned server entrypoint. For recovery,
install it at `/opt/docker-stacks/recipes/backup/offsite/offsite.py`
beside `scripts/offsite_retention.py` in that server directory. Retain
LF line endings (including the executable shebang), retain executable entrypoint
permissions and provision credentials separately; no
credentials or private identity are included in these sources. The test module
remains `scripts/test_offsite_retention.py`.

Phase 6.3D.2 corrects the previous administrative API gate. The earlier
GetBucketPolicy/GetBucketAcl AccessDenied is expected for the limited key and is
not an object-access failure. An idle host lock and stable inventory prove only
local inactivity, not exclusive ownership of the prefix or absolute inability
of another key to write.

In Phase 6.3D.6 the owner confirmed sole account use, one limited Spaces key
`culinote-backup-hetzner` scoped to `culinote-backups` with Read/Write/Delete,
exclusive use by this workflow and no configured independent writers. Preserve
that confirmation in the activation receipt with bucket, prefix, exact policy,
`sole_workflow_writer: true`, source commit and UTC timestamp. This is an owner
attestation, not technical proof that another key could never be created. Changes
to account/key consumers require a new concurrency review. Do not upgrade keys.

Activation sources belong to `infra/culinote-automatic-retention`, independently
of Backend v0.2. The PR runs the retention suite on Linux without credentials or
network S3 access, alongside existing application CI. Application runtime, local
backup code, credentials, private identity and OCI registry are unchanged.

## Controlled activation evidence

On 2026-10-28 the fresh pre-activation plan had zero candidates and hash
`b43746c5f77320bc45d4484c8894b7d56ec89adf9ef7ef7b41b23739ca0709d1`.
After a controlled normal service run reverified the existing backup and updated
its success timestamp, the GC plan hash became
`eb20d64c5ea5b338c1cc13ca84663507760100fe05e815f99a7a2c9ceb112edd`.
Both the post-upload GC cycle and an explicit repeat passed with zero deletions;
all ten remote objects and their ETags were preserved. Both daily snapshots
remain; weekly `2026-W44` and monthly `2026-10` reference the protected recovered
snapshot `20261027T155249Z-012c8349-1a6e2ddc5110`.

These hashes are evidence, not reusable approval for a later inventory. The
automatic workflow always rebuilds its plan. Real nonempty GC has been tested
only with isolated fixtures; no production object was deleted for activation.
