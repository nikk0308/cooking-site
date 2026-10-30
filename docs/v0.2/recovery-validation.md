# Recovery evidence and limits

Current merged-source acceptance is consolidated in the
[Phase 6.8 closeout](phase-6.8-closeout.md): nine recovery tests, including mixed
historical CRLF/LF ledger restore, passed after the security merge. This remains
isolated synthetic evidence. Phase 7 real release-bound offsite decrypt/restore,
actual old-image/config preservation and fresh checkpoint are NOT completed.

Local synthetic PostgreSQL 18 full dump/media restore: **PASS**.
`tests/recovery/inventory-restore.test.ts` verifies exact schema/data hashes,
UUIDs/FKs, receipts/source mapping, provenance and decimal strings, media hashes,
UNCHANGED repeat import, working revision triggers and post-restore recipe writes.
Checksum corruption, incomplete inventory, disabled/missing schema objects,
nonempty or non-isolated targets and failed media capture are rejected.
Initial local testing avoided redundant restore reruns; the expanded mandatory
CI now exercises recovery on each exact reviewed and merged source.

`application-rollback.test.ts` additionally requires Linux Docker runtime and
rebuilt v0.1 images, starts each against a restored synthetic database, verifies
readiness/public media/admin login, non-root/read-only execution and extended
catalog preservation through the old admin API. Its mandatory CI result is the
application startup/rollback evidence; a SQL restore alone is not that proof.

Historical readiness production metadata: no new snapshot download or production DB inspection
was performed. Installed backup source was inspected read-only to understand the
old schema/SHA guards. Prior recovery-verified point remains
`20261027T155249Z-012c8349-1a6e2ddc5110`; this phase does not change its protection.

Real production v0.2 offsite decrypt/restore: **PENDING_OWNER_AUTHORIZATION**.
No age private identity was requested, read, copied or transferred. Ciphertext
checksums cannot substitute for actual decryption and restore.

## Owner-assisted release gate (not executed)

1. Under separate release authorization, create/upload/verify a full v0.2 point.
2. Owner uses the existing Windows helper to download/decrypt locally, without
   its legacy server `-RunRestoreDrill` option. The old server drill does not
   implement the new inventory contract. Keep plaintext private and outside sync.
3. On a disposable PostgreSQL 18 host, with explicit empty database named
   `culinote_restore_` followed by 32 lowercase hex characters, use reviewed tool
   source/policy matching the snapshot. Transfer only the owner's approved
   plaintext payload to that isolated host if separately authorized; never the
   private age identity. REMOTE-COMPLETE.json remains beside decrypted files.

```sh
npx tsx scripts/backup/cli.ts --mode restore --policy /private/snapshot-policy.json --directory /private/owner-decrypted --database-env BACKUP_RESTORE_URL --pg-container "$ISOLATED_PG" --media /private/fresh-restored-media --runtime-sha "$SNAPSHOT_APP_SHA" --confirm-isolated-restore --owner-decrypted-payload
```

4. Validate application readiness and all inventory/media checks on that target;
   owner records snapshot ID, report and explicit restore PASS. Only then consider
   replacement of the protected point, via separately reviewed existing GC proof
   rules. The CLI itself never certifies age decryption or modifies recovery proof.
5. Delete only verified disposable plaintext paths after success, preserving the
   offline identity and original encrypted snapshot. On SSDs file deletion is not
   a secure erase guarantee; use encrypted temporary volumes for the drill.

The owner-payload unit scenario uses a synthetic marker. It proves binding and
rejection behavior, not an actual Spaces download/decrypt.
