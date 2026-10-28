# Phase 6.5–6.8 acceptance criteria

## 6.4 delivered foundation

Versioned contracts, browser repositories/Blob ownership, favorites, shopping persistence/migration and shared calculations, additive catalog migration/read interfaces, portable export schema and tests. No user-facing personal recipe/favorite/shopping UI is shipped in this foundation.

## 6.5 public/personal recipes and favorites — implemented

- Reuse published-only server reads and PUBLIC/LOCAL references; inaccessible public recipes stay unavailable.
- Wire personal CRUD/duplicate/photo and favorite UI to IndexedDB. Reload retains data; quota/corruption/upgrades have actionable errors without reset.
- Use stable local product IDs; no name-based identity guessing. Local content/photos never auto-upload.
- Implement user-initiated bounded export/import with image decoding, validation, atomicity and collision policy; preserve originals on failure.
- Verify mobile/browser E2E, accessibility, no SSR/hydration interaction race and no private outbound payloads.

Routes and owner walkthrough: personal-data-workflows.md. Atomic portability uses conservative conflict rejection; no destructive conflict resolver or import-as-copies is included. Images remain browser-owned. No shopping UI switch, production deployment or production migration is included.

## 6.6 unified shopping

- Wire shopping v2 UI with portions, manual products, checked rows and editable quantities using existing calculation contracts.
- Invoke and verify basket v1 migration before showing the unified list; retain source and handle LEGACY_CHANGED reconciliation explicitly.
- PUBLIC/LOCAL and same-UUID references coexist, CUSTOM never auto-merges, unavailable recipes stay visible, edits and purchased state survive reload/reordering.
- Test transaction/storage failure, repeated migration and undo/reset policies without silent data loss.

## 6.7 catalog and importer

- Protected admin category/alias/provenance CRUD with bounded validated requests and authorization tests.
- CSV/JSON importer: preview/dry-run, source IDs, deterministic duplicate handling, transactional application and no destructive ID reassignment.
- Measure search at expected scale and provide indexes/pagination. Unknown nutrition remains explicit; no invented density or brand/SKU mixing.

## 6.8 integration, stabilization and release

- Complete end-to-end public/local/favorite/shopping/import flows and cross-browser storage checks.
- Run full CI, migration upgrade/data-preservation and isolated recovery validation against the release inventory.
- Follow release-and-backup.md with separately authorized production backup/guard updates, migration, deployment and rollback decisions. No phase starts implicitly from completion of 6.4.
