# ADR 0001: Foundation architecture

Status: accepted for Phase 3.

Recipes is a Next.js 16 App Router strict-TypeScript modular monolith. Browser traffic will terminate at host Nginx and reach the app only at `127.0.0.1:3200`. There is no separate API or microservice split.

PostgreSQL 18 is the system of record. Drizzle with `pg` provides access. PostgreSQL NUMERIC stays a string at the driver/domain boundary and `decimal.js` performs canonical arithmetic. Phase 3 has no domain tables; the first migration belongs to Phase 4.

Public catalog pages will use SEO-appropriate server rendering. Published-state checks must eventually live at the data boundary. Admin/auth, recipes, categories, quantities, units, nutrition, search, and publishing are deferred. The future anonymous basket uses browser `localStorage` unless later requirements justify persistence.

The app runs as UID/GID 10001 in a Debian slim multi-stage standalone image. Production references must use approved digests. Rootfs is read-only, with bounded tmpfs at `/tmp` and `/app/.next/cache`; build ownership alone is insufficient after a runtime mount. Phase 3 proves server rendering and the Next image runtime cache, but not Next Data Cache or full-route runtime revalidation. When Phase 4 introduces the first cached recipe/catalog route, the read-only-rootfs smoke must exercise its real cache and revalidation before production acceptance. Future media is isolated at `/app/media`, backed by `/opt/docker-data/recipes/media`, and is not mounted or created now.

PostgreSQL has no host port and uses a private internal network. Local development uses a project-scoped named volume. Production requires an external host bind directory through `RECIPES_POSTGRES_DATA_DIR`; its expected future server value is `/opt/docker-data/recipes/postgres`, mounted at PostgreSQL 18's `/var/lib/postgresql` root with `PGDATA=/var/lib/postgresql/18/docker`. Production image references and secrets stay in external server-side configuration. Redis, queues, object storage, orchestration, metrics stacks, and deployment automation are deferred.
