# Local media storage

The Phase 6.8 [security correction](v0.2/security-remediation.md) adds binary
JPEG/PNG/WebP preflight before constructing Sharp, a native SVG-loader block,
and patched framework/native dependencies. A MIME/extension claim is never
accepted as format evidence; corrupt raster candidates still fail native validation.

MEDIA_ROOT identifies the writable directory. Production Compose mounts required RECIPES_MEDIA_DIR at /app/media; missing source configuration fails closed.
Expected future host convention: /opt/docker-data/recipes/media. Create it during an separately authorized deployment and assign UID/GID 10001:10001. No server paths are created by application development.
The rest of /app remains read-only; /tmp and /app/.next/cache keep their tmpfs contracts. Local Compose uses a dedicated named volume.
Only authenticated, same-origin uploads are accepted. A bounded streamed body rejects more than 10 MiB. Sharp decodes JPEG/PNG/WebP only, rejects SVG and multi-frame images, caps decoded pixels at 20 million, strips metadata and emits WebP up to 2000×2000.
Server-generated UUID keys never use user filenames. A same-directory exclusive temporary file is renamed atomically. Failed database insertion removes only the newly created file.
Recipe cover FK uses SET NULL; deleting a media record does not delete a shared recipe. Replacing covers does not delete previous files. Back up media with PostgreSQL; orphan reconciliation/garbage collection is deferred.
GET /media/[key] validates UUID key and resolves a known cover attached to a published recipe. Draft-only uploads are not publicly served. Responses use image/webp, nosniff and short public caching (60 seconds; a previously cached cover may outlive unpublication by that interval).
Readiness probes DB and creates/removes one unique media probe; liveness does not depend on either.

## Private file mode and separately provisioned backup reader

The writer requests mode0640 for new exclusive WebP temporary files, never
world-read/write. The owner must separately install a narrow named default ACL
for the dedicated backup reader on the media directory, with traversal and read
only. Mode0600 would mask out that inherited reader ACL. Ordinary group read
alone is not proof of access by the intended reader, and no Docker/shared-app
group membership is required or provisioned by the application.

A final UUID key is reserved exclusively before the same-directory atomic rename;
existing keys are never overwritten. A reservation has no DB/public reference;
the completed WebP retains its temporary file ACL after rename. Failures remove
only files created by that attempt; failed DB insertion still removes the new
image. Existing images are never recursively chmod/chown'd. Readiness probes
remain0600 and test owner write availability only, not backup-reader access.

Host ACL/ownership acceptance for existing AND future images is a production
installation requirement, not an automatic application action. Without that ACL,
the cross-UID test proves reader denial rather than claiming backup readiness.
Published and draft referenced images are both readable by the authorized full
backup reader; public HTTP publication/session guards remain unchanged. Browser
IndexedDB photos are outside this server-file contract.

CI builds a disposable maintenance-derived image with Debian ACL tooling and
executes the actual writer as UID10001, reader10002, unrelated10003, read-only
rootfs, no network, no capabilities and private tmpfs. It verifies effective ACL,
hashes, rename, read-only reader and absence-of-ACL denial. These test packages and
identities are never installed in production images or on a production host.
