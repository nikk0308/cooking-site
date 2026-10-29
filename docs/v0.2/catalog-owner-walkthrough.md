# Disposable catalog walkthrough

Use a fresh disposable PostgreSQL 18 database and browser profile. Do not point DATABASE_URL at production. Run migrations on this disposable database, bootstrap a disposable admin with `npm run admin:create`, then `npm run dev -- --hostname 127.0.0.1`; open `http://127.0.0.1:3000/admin`. Automated equivalent: `npm run test:e2e -- tests/e2e/catalog.spec.ts` creates and removes its own database and test administrator.

Example disposable Windows setup (choose unused local ports/container name; passwords below are **local test examples**, never production credentials):

```powershell
docker run --detach --name culinote-owner-catalog-test --publish 127.0.0.1:15467:5432 --env POSTGRES_USER=recipes --env POSTGRES_PASSWORD=owner-test-only --env POSTGRES_DB=catalog_disposable --tmpfs /var/lib/postgresql/18/docker postgres:18
# Wait until this container reports readiness with pg_isready before migrating.
docker exec culinote-owner-catalog-test pg_isready -U recipes -d catalog_disposable
$env:DATABASE_URL='postgresql://recipes:owner-test-only@127.0.0.1:15467/catalog_disposable'
npm run db:migrate
$env:ADMIN_EMAIL='owner-test@example.invalid'
$env:ADMIN_PASSWORD='Disposable-catalog-example-2026!'
npm run admin:create
npm run dev -- --hostname 127.0.0.1
```

Use the disposable login above at the local URL. No demo seeding is needed for the catalog walkthrough. Stop the local dev process after testing; remove only this explicitly created disposable container if desired. Never use production database/administrator values here.

1. Open Categories, create a synthetic category, rename it/change its slug deliberately. Duplicate normalized category names/slugs must fail. A used category cannot be deleted; explicitly reassign its ingredients first.
2. Open Ingredients. Create a synthetic ingredient, category and newline-separated aliases. Enable nutrition: every numerical field must be empty. Either leave nutrition unknown or intentionally enter clearly labelled synthetic test values with a source note. Save.
3. Search by alias, open the single edit page. Change only category/aliases and save/reload: nutrition/provenance/UUID must remain. Removing nutrition asks for confirmation.
4. Create/edit a disposable public recipe. Search by an alias, select one of at most ten candidates; edit must preserve selected UUID even outside the current search. Do not publish real test data to production.
5. Open Import; download the synthetic CSV and JSON templates. Preview one, inspect all proposed changes and fingerprint, confirm. Preview it again: UNCHANGED, same UUID, no duplicated aliases. Inspect a downloaded report.
6. Change a source record and preview its UPDATE. Manually edit that imported ingredient, then preview again: inspect the conflict and choose KEEP or REPLACE explicitly. Matching a manual product requires DISTINCT or explicit link; never automatic adoption by name.
7. Preview a fresh file, change any catalog/category record in another tab, confirm: STALE_PLAN and no import writes. Preview again before applying.
8. Try malformed JSON/CSV, wrong schema version, missing nutrition values, ambiguous decimals and unknown units. No partial import should occur. The invalid fixture is `tests/fixtures/catalog-invalid.json`.
9. In a disposable browser personal recipe or shopping list, explicitly search for an imported ingredient. Confirm CATALOG UUID and missing/known nutrition semantics. No personal content is uploaded. At 390 px, verify labels, keyboard controls and no horizontal overflow.

Only isolated test databases may be removed after testing. Browser data is separate: export personal browser data before deleting a profile/site data. Do not change server backups, GC, credentials or production services for this walkthrough.
