# Admin bootstrap and controlled deployment

No migrations or bootstrap run automatically on normal application startup.
Build the runtime Docker target normally; build a separate maintenance image with docker build --target maintenance. The maintenance image contains migration/seed/bootstrap tools; it is not the web runtime.

## Future deployment sequence (not executed in development)

1. Back up the dedicated Recipes database with pg_dump -Fc to its dedicated backup area. Include the media directory in backup/restore planning.
2. Start the dedicated PostgreSQL service. Use the maintenance image on the Recipes database network with DATABASE_URL supplied securely; run npm run db:migrate once as an explicit deployment step.
3. Start/update the runtime application and verify readiness.
4. Run npm run admin:create in the maintenance image once, passing ADMIN_EMAIL and ADMIN_PASSWORD only in the current command environment. Password must be 12–128 characters. Do not put them into a file, CLI argument, image, or persistent runtime configuration; unset both afterwards. The command never prints credentials or hashes and refuses duplicate email.
5. Run npm run db:seed-demo only if the owner explicitly wants demo content.
   Use interactive secret entry in the deployment shell when populating command environment. Production runtime needs neither a bootstrap password nor a session secret.

## Runtime configuration

DATABASE_URL, MEDIA_ROOT=/app/media, NODE_ENV=production; optionally DATABASE_QUERY_TIMEOUT_MS (default 2000, maximum 10000) and SITE_URL (public HTTPS origin for absolute canonical/OpenGraph metadata).
Compose requires RECIPES_APP_IMAGE, POSTGRES_IMAGE, POSTGRES_PASSWORD, RECIPES_POSTGRES_DATA_DIR, RECIPES_MEDIA_DIR. Future loopback port remains 127.0.0.1:3200.
TLS reverse proxy must preserve the original Host header. Mutation Origin must exactly match Host and use HTTPS in production. Forwarded IP is not trusted for throttling.

## Authentication

Salted scrypt (N=32768,r=8,p=1), 64-byte derived password hash. Random 32-byte session tokens; only SHA-256 token hashes in PostgreSQL. Host-only HttpOnly SameSite=Lax cookies; Secure and __Host- prefix in production.
Sessions expire absolutely after 12 hours and after one hour idle; logout revokes the row.
Single-instance in-memory global login throttle: ten attempts per minute. It resets on restart and is not distributed; a global bucket avoids trusting spoofable IP headers. Expired session rows may be pruned later by an explicit maintenance task.
