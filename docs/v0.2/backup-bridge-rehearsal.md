# Bridge transition and final freeze

## Mandatory isolated evidence

The `backup-bridge` CI job runs non-root Linux, PostgreSQL 18.6 and the pinned
Node 24.20.0 bundle. It uses synthetic databases/credentials, real private files,
the actual CLI/wrapper, Unix broker and Docker inspection/dump/list commands.
No Spaces or production operations occur. Fixtures are outside the checkout;
no database/config/image artifacts are uploaded.

```sh
python3 -B -m unittest discover -s scripts -p test_backup_broker.py -v
python3 -B -m unittest discover -s scripts -p test_backup_bridge.py -v
python3 -B -m unittest discover -s scripts -p test_backup_gate.py -v
BACKUP_TEST_PG_CONTAINER=ISOLATED_CONTAINER BRIDGE_ENVIRONMENT_DIR=/private/environment \
  npx vitest run tests/bridge --reporter=verbose
```

Supply the existing isolated DATABASE_URL launcher input; never production.
Windows-native peer/flock execution is not supported or silently skipped: the
Linux job is mandatory. Windows can run pure broker/offsite capability tests.

The rehearsal generates deterministic v0.1/v0.2 reference fingerprints and a
test-only policy from the actual clean tool checkout, then exercises:

| State             | Proof                                                                           |
| ----------------- | ------------------------------------------------------------------------------- |
| Legacy old/old    | Actual 0000/0001, nine tables and original ingredient UUID                      |
| Bridge old/old    | Private complete capture and full CLI validation                                |
| Migration         | Held backup/upload barrier, real 0002/0003, immediate inventory switch          |
| Old/new           | Fourteen-table capture, category/alias/provenance/source/receipt state          |
| New/new           | Explicit new runtime identity and full v0.2 backup                              |
| App-only rollback | Old runtime identity, full v0.2 capture, unchanged data/UUIDs and repeat import |

New/old, wrong runtime/tool, wrong DB, dirty checkout, absent policy and old
inventory against new schema must fail. Existing recovery tests independently
reject missing triggers/functions/indexes, invalid media/checksums and incomplete
snapshots. Real app startup with new schema and rebuilt v0.1 is covered by the
unchanged recovery suite; identity fixture containers are not fake proof of
actual production-image compatibility.

## Offsite activation

Before activation a legacy manifest with no versioned settings remains supported.
Any versioned manifest, source/policy setting, required flag or persistent
`state/backup-bridge-required.json` receipt requires versioned validation.
Removing environment settings after receipt activation does NOT restore fallback.

The owner-installed private receipt is format 1 with `tool_sha`, `policy_sha256`
and `protected_snapshot`. It must bind the approved policy, source tool identity,
manifest and existing recovery proof. The approved policy's protected ID must
match the reviewed build inputs. The receipt is NOT generated/installed here.
After activation even a legacy manifest must fail rather than masquerade as a
new-schema backup. Missing Node, source, policy or contract fails before encryption,
publish or GC. Do not remove the receipt or guard to repair a failed upload.
New local backups remain independent of offsite failures.

## Final freeze — no feature-branch production policy

Current application candidate is `12fb36f58e6bb759394337487fabb601b3fdce9c`.
The final TOOL_SHA is deliberately separate: after this PR merges, select its
exact reviewed merge/source commit and clean checkout. Never substitute a
last-file commit or the old application SHA for the actual tool checkout HEAD.

1. Record source, environment artifact ID/attestation, immutable app/PG digests,
   old runtime SHA, package-version decision and successful exact-source CI.
2. On disposable PG 18.6 environments, generate both reference inventories using
   the selected tool source and locked dependencies. Repeat and compare schema
   fingerprints and all object/ledger/unit contracts. Review live v0.1 metadata
   against that reference separately; schemaHash is not a raw dump hash.
3. Use `prepare.ts --mode policy` with those references, explicit old/new SHAs
   and an EXCLUSIVE private output path. It binds actual tool checkout HEAD and
   the protected point. This produces a CANDIDATE, not approval.
4. Review exactly three pairs: old/old, old/new, new/new; reject new/old and every
   unknown identity/fingerprint. Approve the policy checksum in a release record
   outside Git. A changed image/source/version/tool/reference invalidates freeze.
5. Only separate owner approval permits environment provisioning, service wiring,
   receipt creation, pre-migration capture/offsite proof, write-freeze, migrations
   and deployment. Rehearsal does not establish installed-service compatibility.

The safe release ordering remains bridge-v0.1 first, guarded offsite first, then
held maintenance locks and DB migration before new app; switch inventory under
those locks. Old/new capture is required before replacement, and a new/new capture
must bind the current runtime before offsite acceptance. App-only rollback keeps
the fourteen-table inventory and the old/new rule. Never revert the backup bridge
to a nine-table script or bypass deployed-SHA checks.

## Application version metadata

`package.json`/lockfile currently say 0.1.0. Release identity/backup authorization
uses exact OCI revision SHA + image ID and schema/tool policy, not that string.
No version bump is made in bridge work. Before final freeze the owner must either
accept the displayed package-version limitation with an explicit v0.2 release
record, or separately review a version bump. A bump changes RELEASE_SHA, needs
new build/CI and invalidates previous candidate app/policy bindings.

Real release-bound offsite decrypt/restore remains PENDING_OWNER_AUTHORIZATION.
Historical protected proof and synthetic restore are separate evidence.
