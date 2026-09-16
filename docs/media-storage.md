# Local media storage

MEDIA_ROOT identifies the writable directory. Production Compose mounts required RECIPES_MEDIA_DIR at /app/media; missing source configuration fails closed.
Expected future host convention: /opt/docker-data/recipes/media. Create it during an separately authorized deployment and assign UID/GID 10001:10001. No server paths are created by application development.
The rest of /app remains read-only; /tmp and /app/.next/cache keep their tmpfs contracts. Local Compose uses a dedicated named volume.
Only authenticated, same-origin uploads are accepted. A bounded streamed body rejects more than 10 MiB. Sharp decodes JPEG/PNG/WebP only, rejects SVG and multi-frame images, caps decoded pixels at 20 million, strips metadata and emits WebP up to 2000×2000.
Server-generated UUID keys never use user filenames. A same-directory exclusive temporary file is renamed atomically. Failed database insertion removes only the newly created file.
Recipe cover FK uses SET NULL; deleting a media record does not delete a shared recipe. Replacing covers does not delete previous files. Back up media with PostgreSQL; orphan reconciliation/garbage collection is deferred.
GET /media/[key] validates UUID key and resolves a known cover attached to a published recipe. Draft-only uploads are not publicly served. Responses use image/webp, nosniff and short public caching (60 seconds; a previously cached cover may outlive unpublication by that interval).
Readiness probes DB and creates/removes one unique media probe; liveness does not depend on either.
