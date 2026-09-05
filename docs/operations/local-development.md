# Local development

Install Node.js 24.20.0 and run `npm ci`. Private env files are ignored and must never be committed.

The supported zero-edit workflow is `docker compose -f compose.local.yaml up --build`, then open `http://127.0.0.1:3000`. Local PostgreSQL uses the project-scoped `postgres_data` named volume and intentionally has no host-published port. To run the app with host npm, supply a real reachable PostgreSQL 18 `DATABASE_URL` (or add an intentional temporary loopback-only DB mapping locally).

Production differs deliberately: it has no named PostgreSQL volume and requires an external bind directory via `RECIPES_POSTGRES_DATA_DIR`. The future server value is `/opt/docker-data/recipes/postgres`; do not create or change that path from local development.

Use `npm run test:unit`. Integration tests require `DATABASE_URL` and skip when absent. Install Chromium with `npx playwright install chromium`, then run `npm run test:e2e`. Validate Compose with `npm run docker:config`.

Stop resources with `docker compose -f compose.local.yaml down`. Add `--volumes` only when deliberately discarding this project's development database.
