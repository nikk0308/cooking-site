# v0.2 release readiness (Phase 6.8A)

Base: `0d49a7ac777e8788992ab020de1dbe5af0ff38dd`. Branch:
`release/v0.2-readiness`. This is preparation, not release authorization.
Production remains v0.1; production mutations and App Architector changes: **0**.

## Evidence and reproduction

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

The PR's checks on its exact head are the authoritative final CI evidence;
an earlier commit's results are not sufficient. See the accompanying browser,
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

Phase 6.8B, real dataset population and production release are not started.
