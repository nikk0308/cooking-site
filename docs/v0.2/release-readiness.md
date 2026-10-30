# v0.2 release readiness

Current source-level acceptance and Phase 7 handoff are recorded in the
[Phase 6.8 closeout](phase-6.8-closeout.md), against merged security source
`e51ee79c07eb74c85d1ae63ab0061e3cc755dc1b` and its new post-merge CI.
Production approval is separate. Merging patched source did not patch live v0.1;
the urgent current-v0.1 security action remains explicitly pending there.

## Historical Phase 6.8A baseline

Base: `0d49a7ac777e8788992ab020de1dbe5af0ff38dd`. Branch:
`release/v0.2-readiness`. This is preparation, not release authorization.
Production remains v0.1; production mutations and App Architector changes: **0**.

## Historical evidence and reproduction

Counts below retain the initial readiness baseline, not the expanded current
suite. Use the closeout matrix and exact merged-source CI for final acceptance.

Use Node 24.20, `npm ci`, an isolated PostgreSQL 18 `DATABASE_URL`, and the
committed CI workflow. Never point these commands at production.

| Gate                                              | Reproducible evidence                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Existing domain contracts                         | `npm run test:unit` (104 tests)                                                                         |
| SQL, importer, clean/upgrade/failure preservation | `npm run test:integration` (25 tests)                                                                   |
| Immutable history and drift                       | `npm run db:check` and `npm run db:drift-check`                                                         |
| Browser regression                                | `npm run test:e2e` (49 scenarios per engine)                                                            |
| Complete feature journey/fallbacks                | `npm run test:e2e -- --config=playwright.release.config.ts` (4 per engine)                              |
| Cross-engine portable backups                     | `npm run test:e2e -- --config=playwright.portability.config.ts` (9 source/target pairs)                 |
| Hydration/scaling repeats                         | CI repeats both existing scenarios three times                                                          |
| Schema/data/media restore and guards              | `npx vitest run tests/recovery --reporter=verbose` (explicit isolated PG container and images required) |
| Retention remains unchanged                       | 44 Python retention tests plus 4 prepared versioned-gate tests                                          |
| Runtime/build/startup                             | pinned-input Docker builds, isolated Compose smoke, rebuilt v0.1 rollback test                          |

Exact-source PR checks support review; new post-merge CI is required for merged
acceptance. An earlier commit's results are not sufficient. See the browser,
migration, inventory and recovery reports for limitations. No failing gate is
waived by this document.

## Implemented stabilization

- BroadcastChannel absence or SecurityError uses existing focus refresh plus
  visibility refresh; transactional writes still prevent stale overwrites.
- Import harness waits for the actual enabled repository-backed input. No
  arbitrary sleep or increased assertion timeout.
- Firefox form-state restoration is disabled for portability controls so stale
  disabled attributes cannot contradict SSR readiness during hydration.
- A versioned backup adapter explicitly verifies schema objects and binds the
  runtime SHA, tool SHA and schema fingerprint. Nothing is installed live.
- Docker test tags and isolated project names no longer assume a v0.1 release.

## Pending production-release gates

Separate owner authorization is required for installation, write freeze,
migrations, deployment and any rollback. Record actual running SHA and immutable
image/configuration; verify current backup/offsite/watchdog health and free space;
approve the bridge policy against actual schema and isolated reference schemas;
validate tools/dependencies on the deployment host; preserve the recovery-verified
point; create a verified pre-migration point and perform owner-assisted offsite
decryption/restoration. Real v0.2 offsite recovery is
**PENDING_OWNER_AUTHORIZATION**. Synthetic recovery does not satisfy it.

Bridge preparation and the later media/broker/security source corrections are
merged; production installation/recovery/deployment are Phase 7 gates, NOT STARTED.
No real dataset population or production release was performed by readiness work.
