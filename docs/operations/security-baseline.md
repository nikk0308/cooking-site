# Security baseline

Production-like Compose publishes only the app on loopback. PostgreSQL remains internal. The app is non-root, drops all capabilities, enables `no-new-privileges`, limits PIDs, uses init, and has read-only rootfs.

Writable paths are bounded tmpfs: `/tmp` (64 MiB) and `/app/.next/cache` (128 MiB), owned for UID/GID 10001. `/app/media` is a deferred bind mount; Phase 3 does not create it. Validate with `node scripts/smoke/production-container.mjs` while the stack runs.

The current smoke proves server rendering and Next image runtime cache writes. It does not prove Next Data Cache or full-route runtime revalidation. Before production acceptance of cached recipe/catalog routes, Phase 4 must extend the read-only-rootfs smoke to exercise actual application cache and revalidation.

Production PostgreSQL storage is an external host bind directory required through `RECIPES_POSTGRES_DATA_DIR`, expected eventually to be `/opt/docker-data/recipes/postgres`. It mounts at `/var/lib/postgresql`; PostgreSQL 18 uses `PGDATA=/var/lib/postgresql/18/docker`. Before first deployment, resolve the exact `POSTGRES_IMAGE` digest, read-only verify its actual PostgreSQL UID/GID and layout, inspect any existing server directory, and only then decide whether ownership changes are needed. Never apply recursive `chown` automatically.

Production app and PostgreSQL images MUST be explicitly configured with reviewed digest references; there are no floating production fallbacks. Foundation tags are test-only. Credentials are supplied server-side and never stored in repository files or images. This is a baseline, not a production runbook.
