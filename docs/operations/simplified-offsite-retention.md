# Culinote simplified offsite retention

Phase 6.3D prepares retention; **remote deletion remains disabled**. No timer or
CLI mode calls the GC executor. Changing the existing private configuration alone
does not enable it. No credentials or private age identity belong in this file.

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
imports `offsite_retention.py`. Successful uploads establish period references
and produce a dry-run plan before recording upload success. Dry-run and upload
share `state/upload.lock`. Watchdog verifies weekly and monthly references as
well as the current daily snapshot. Local backup code and all timer schedules
are unchanged.

## GC safety and activation gate

`execute()` defaults to disabled. It requires a separately approved plan SHA-256
and explicit enablement. There is deliberately no production invocation yet.

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
every deletion, the inventory must match; before each blob deletion all remaining
references are re-read. ETag and byte size must match the approved inventory.
Every delete is individually confirmed; errors stop further deletes. A partial
failure can leave extra orphan ciphertext, which blocks further planning until
reviewed. There is no blind orphan cleanup or `sync --delete`.

All writers must use the same host lock. GC is not safe with an independently
writing second host or an operator modifying Spaces concurrently; enabling that
architecture requires a distributed concurrency design first. The lock does not
make a sequence of S3 operations transactional.

For future activation: review a fresh production plan and its exact keys/bytes,
verify the protected point, confirm exclusive writers and permissions, then
separately authorize the execution entrypoint and scheduling. Do not turn this
preparation into an unattended deletion command without that review.

## Verification

```powershell
python -B -m unittest discover -s scripts -p test_offsite_retention.py -v
```

Tests use an in-memory S3 implementation; executor deletes only that fixture.
Production dry-run is the existing `offsite.py retention-dry-run` mode; its output
is stored in `state/retention-dry-run.json`, including exact keys, byte sizes,
ETags, protected snapshot and the approval hash. Production deletion was not run.

## Recovery source inventory and activation status

`scripts/culinote_offsite.py` is the exact Phase 6.3D server entrypoint, saved from
`/opt/docker-stacks/recipes/backup/offsite/offsite.py`. For recovery, install it as
`offsite.py` beside `scripts/offsite_retention.py` in that server directory. Retain
the executable entrypoint permissions and provision credentials separately; no
credentials or private identity are included in these sources. The test module
remains `scripts/test_offsite_retention.py`.

Phase 6.3D.2 corrects the previous administrative API gate. The earlier
GetBucketPolicy/GetBucketAcl AccessDenied is expected for the limited key and is
not an object-access failure. Automatic deletion remains **disabled** until the
owner confirms account access and separately authorizes activation. An idle host
lock and stable inventory prove only local inactivity, not exclusive ownership
of the prefix or absolute inability of another key to write.

Before activation, the owner must review DigitalOcean Access Keys, the list of
account/team users, and all write-capable keys/roles and their consumers,
including CI, workstations and other hosts. Confirm that no independent writers
are configured for `culinote/`, or ensure all configured writers participate in
the same lock. Do not upgrade to a full-access key or paste credential values
into the review. Then rerun fresh-plan gates; any nonempty deletion list requires
separate owner approval. The prepared GC still has no production invocation.

Sources belong to `infra/culinote-retention-activation`, independently of Backend
v0.2. The PR runs the retention suite on Linux without credentials or network S3
access, alongside the existing application CI. Merge and GC activation are
separate stages; neither is implied by publication of the branch and PR.
