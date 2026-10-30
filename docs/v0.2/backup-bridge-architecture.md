# Backup bridge preparation — NOT INSTALLED

Source-level bridge/media/broker/security acceptance is consolidated in the
[Phase 6.8 closeout](phase-6.8-closeout.md). Live UID/GID/ACL/socket, host ABI,
systemd credentials/sandbox and daemon-side PG drain acceptance remain Phase 7
gates. No template, source merge or CI proof is an installation authorization.

This is a reviewed-source proposal and isolated rehearsal, not production
authorization. It extends `cli.ts`, inventory/guard/archive and the existing
offsite gate. It is not a second database backup system.

## Decision: host-side private environment, constrained Docker broker

Choose option A with an explicit privilege split. `environment.Dockerfile` builds
a provisioning-only artifact from pinned Node 24.20.0 and `npm ci`. Extract it
without starting the scratch image. No Docker socket, host data or credentials
are mounted into that image. At backup time no container is created and no
dependency is downloaded. The host executes its private Node binary with the
existing versioned adapter. Host ABI/architecture compatibility must be checked
before installation; success on Ubuntu CI is not proof for an arbitrary host.

The unprivileged `culinote-backup` account must NOT belong to `docker`, have sudo,
or access the Docker daemon socket. Its only privileges are read access to the
immutable source/environment/policy and referenced media, its private output
directory, the specific backup lock, its database credential and the broker bus.
The DB credential must be a dedicated non-superuser role with SELECT/USAGE and
explicit `pg_control_system()` execution, no memberships, CREATE or write grants.
New tables need corresponding read grants under the authorized migration lock.
Never solve a failed capture by granting superuser or broad write access.

The separately trusted `culinote-backup-broker` account has Docker-group access.
**That is root-equivalent host authority**, even though its UID is non-root.
It is a critical reviewed component, not an untrusted sandbox. Its explicit
`--allow-docker-authority` flag, private configuration, fixed Unix daemon socket,
sanitized CLI environment, peer UID checks and strict operation allowlist keep
that authority out of the runner. Compromise of the broker itself remains a
host-security risk. Do not expose it over TCP or share its identity with apps.

The broker permits only:

- Exact app revision/image/project/service inspection, excluding environment.
- Exact PostgreSQL image inspection.
- A fixed system-identifier SELECT for the explicit database/user.
- `pg_dump -Fc --snapshot=...` of that same database/user.
- `pg_restore --list` on a bounded input stream, never database restore.

Every operation checks approved container project/service, runtime SHA/image,
PostgreSQL image and read-only database-role privileges. PostgreSQL commands run
as an explicit nonzero container UID. Shell, arbitrary SQL, other containers,
Docker run/build/cp/mount/delete and restore-to-database are not client APIs.
Frames, input size, concurrent workers and command duration are bounded. Errors
never return stderr, environment values or connection strings. The client also
checks the broker's kernel peer UID. All targets are explicit; none are discovered.

## Private immutable environment and source

Build only in disposable CI/local Linux, following the provisioning step in CI:

```sh
docker build -f scripts/backup/environment.Dockerfile -t culinote-bridge-env:review .
ENV_IMAGE_ID=$(docker image inspect --format '{{.Id}}' culinote-bridge-env:review)
CID=$(docker create --user 10001:10001 "$ENV_IMAGE_ID" /unused)
mkdir -m 700 /private/bridge-environment
docker cp "$CID:/bundle/." - | tar -x --no-same-owner -C /private/bridge-environment
chmod 700 /private/bridge-environment
docker rm "$CID"  # only this never-started provisioning fixture
```

Record the immutable artifact ID, Node/base identity and environment.json SHA256
outside Git. The attestation binds Node bytes, lockfile and the dependency tree.
`bridge.py` verifies all of these before running Node, plus architecture and
exact version. Provision a separate clean exact TOOL_SHA checkout; link its
ignored `node_modules` to that artifact's dependencies. Runtime validates the
link and clean Git identity. No `npm install`, moving branch or mutable tag is
used at execution time.

On a future host, source, Git metadata, dependencies, Node and approved policy
must be owned by a trusted installer, non-writable to the runner, and readable
only by the approved group. Grant Git safe.directory only for this exact private
source path in the process environment; do not alter global Git configuration.
The runner disables fsmonitor/optional Git locks and has a minimal environment.
Configuration/credentials must be regular private files; symlinks are rejected.
The output parent must be private, not a repository or publicly synchronized path.

The Linux CI fixture uses the existing CI user's Docker authority for the broker
and tests real kernel peer rejection and command restrictions without sudo.
It does not claim to prove production account/group/systemd ACL separation.
That remains an installation acceptance gate.

## Explicit runner configuration

`bridge.py --config /private/bridge.json --mode capture` supports capture and
validate only. Configuration is strict, format 1, with these required keys:

```text
source environment environment_manifest_sha256 policy tool_sha runtime_sha
inventory_version database database_user database_credential app_container
pg_container media destination_root backup_lock broker_socket broker_uid minimum_free_bytes
```

All paths/targets are operator-supplied. The explicit free-space floor is at
least 10 GiB; compare it with the actual installed script's gate before wiring.
`database_credential` is a private file
containing only the approved URL; the database and user must equal the explicit
configuration fields. It is passed in a child environment, never argv/logs.
There is no DATABASE_URL fallback. In the proposed unit use the systemd database
credential path for `recipes-backup.service`. `--directory` is a snapshot name
for capture or an existing absolute child of destination_root for validation.
Capture names remain `YYYYMMDDTHHMMSSZ-xxxxxxxx`. Existing names cannot be reused.

Broker format-1 configuration requires:

```text
runner_uid socket docker docker_socket project app_container pg_container
pg_image pg_uid database database_user runtimes
```

`runtimes` contains one or two exact `{sha,image}` pairs, where image is the
actual image ID. No defaults or placeholders are accepted. The production
project, UID/GID numbers, image IDs and DB endpoint must be frozen from separately
authorized live observations; the isolated fixture is not a production config.

## Locks, completion and proposed unit diff

The runner takes the existing local backup lock, nonblocking and without creating
it. Missing/symlink/public locks fail. Busy returns exit 75 with no false success.
Local capture does not depend on offsite availability or take the upload lock.
Coordinator operations must hold BOTH backup and upload locks, in sorted order,
across migration and inventory/config switching. A successful prior idle check
alone does not grant a later mutation lease. Unit tests exercise overlap using
real flock and independent processes.

SIGTERM/INT/HUP terminate and wait for the runner's child process group before
unlocking. An incomplete directory stays private, has no COMPLETE, and is never
eligible for offsite. Preserve it for investigation, not blind cleanup. Before a
real maintenance transition also inspect broker jobs and PG backup transactions;
a lock disappearing alone is not proof that every daemon-side exec has drained.
There is no automatic production migration or switch command in this proposal.

The existing adapter keeps the six checksum entries, private files, full schema
validation, fsync and COMPLETE-last semantics. A failed capture cannot overwrite
an earlier point. The offsite service still checks local service success and the
runtime/manifest source binding before encryption/publication; GC follows only
successful upload. Encryption format and retention logic are unchanged.

Inactive templates are in `scripts/backup/examples/`. Required future reviewed
diff, NOT performed:

1. Provision separate accounts/bus and immutable environment/source/policy.
2. Delegate only media read access, private daily output and the specific lock;
   preserve offsite root ownership/credentials. No recursive chmod/chown.
3. Provision restricted DB read privileges and private systemd credential.
4. Install the explicit broker allowlist and verify non-root UID separation.
5. Replace only local backup ExecStart/user/sandbox paths with the wrapper.
   Timers remain unchanged. Its success event remains CULINOTE_BACKUP_SUCCESS.
6. Validate a complete bridge v0.1 point before installing the versioned offsite
   gate and its source/policy/Node environment plus persistent activation receipt.
7. Prove service/sandbox permissions, DB networking and normal backups/watchdog
   before authorizing migration. No new PostgreSQL host port or general Node
   installation is required by the design.

The installed legacy script is not tracked. Its reported hash is evidence only;
the full live unit/sandbox/permission diff still requires owner review. Templates
are not certified drop-ins and are never installed by CI.
