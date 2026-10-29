# PostgreSQL 18 upgrade evidence

Historical migrations 0000/0001/0002/0003 are unchanged. No new migration is
introduced in Phase 6.8A and none has been run against production.

`tests/integration/release-upgrade.test.ts`: local **PASS**. Starts with actual
0000/0001 ledger and synthetic recipes in PUBLISHED/DRAFT/ARCHIVED states,
ingredient UUIDs, exact fractional nutrition, recipe lines, steps, media
references, admin and session rows. An intentional relation collision makes the
upgrade fail; no false new ledger or partial category_id survives. After removing
only that fixture collision, migration succeeds and a repeat is a no-op. All
original columns/values remain equal, with four ledger entries and fourteen
tables. Full inventory checks verify generated columns, pg_trgm indexes, revision
function and six enabled triggers.

Existing clean and v0.1 upgrade tests remain mandatory. Run:

```sh
npm run db:check
npm run db:drift-check
npm run test:integration
```

Use only an isolated PostgreSQL 18 DATABASE_URL. Tests create and destroy their
own randomly named databases. Full recovery tests independently restore the
entire resulting schema and reject missing objects. Partially upgraded databases
must stop release until reconciled; do not edit ledger rows to bypass failure.
