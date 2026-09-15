# Repository instructions

- Read this file first. Use `rg` and `rg --files` for search.
- Never modify `D:\Documents\GitHub\app-architector`; it is read-only reference material.
- Production access, deployment, DNS, and GitHub Secrets require explicit separate authorization.
- Never use destructive Git such as `git reset --hard` or `git clean`, and never broadly delete files.
- Never commit `.env`, credentials, keys, certificates, tokens, media, or database files.
- Run relevant format, lint, type, test, build, and Docker checks.
- Commit, push, pull request, merge, and deploy are separate stages; do none implicitly.
- PostgreSQL NUMERIC domain values cross boundaries as strings. Use `decimal.js`, never implicit JavaScript float arithmetic.
- Never convert MASS, VOLUME, or COUNT across dimensions without an explicit ingredient-specific contract.
- Never treat missing or dimension-incompatible nutrition as zero; expose incomplete coverage.
- Future public recipe reads must enforce the publication boundary at the data layer.
- Production rootfs is read-only except explicit mounts/tmpfs: `/tmp`, `/app/.next/cache`, and future `/app/media`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
