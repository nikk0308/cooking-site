# Backup broker effective privilege contract

This source correction is NOT installed. No production credentials or policy are
included. The fixed Docker operations, target/image/project checks, Unix peer UID
and non-root runner boundary are unchanged.

`READ_ROLE_SQL` rejects effective table and column writes, sequence UPDATE/USAGE,
MAINTAIN, ownership, database/schema CREATE, existing forbidden role attributes
and ANY role membership. It covers ordinary/partitioned tables, views,
materialized views and foreign relations in user/system schemas. PostgreSQL's
effective privilege functions include PUBLIC grants, not merely direct ACL rows.
SELECT on tables/sequences, schema USAGE and direct pg_control_system EXECUTE
remain valid. No monitoring-role membership is needed.

Unknown user schemas and executable user SECURITY DEFINER routines fail closed;
their read-only safety cannot be inferred from text. Routine/type ownership is
also prohibited. ALTER SYSTEM and restricted/unknown parameter SET grants are
rejected. The exact built-in pg_catalog.pg_settings view is the narrow exception
to relation UPDATE checks: its ordinary updates change session settings, not
application rows. Restricted parameter rights are checked separately. Other
pg_catalog relation writes are still rejected.

This predicate is privilege acceptance for the dedicated backup role, not a SQL
sandbox or a change to PostgreSQL PUBLIC defaults. Ordinary session settings and
temporary-object defaults are not blanket-revoked. Inventory/export execute the
reviewed fixed operations in READ ONLY transactions; arbitrary SQL is not a broker
operation. A new schema, SECURITY DEFINER routine or privilege pattern requires
review, not a broad allowlist/fallback or superuser grant.

References: [PostgreSQL18 effective privilege functions](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE),
[privileges](https://www.postgresql.org/docs/18/ddl-priv.html),
[pg_settings session behavior](https://www.postgresql.org/docs/18/view-pg-settings.html).

## Mandatory evidence

The Linux backup-bridge job executes actual PostgreSQL18.6 acceptance/rejection
tests, including column INSERT/UPDATE, PUBLIC grants, sequence nextval/setval,
writable views/foreign relations, materialized-view MAINTAIN, CREATE, ownership,
membership and privileged attributes. Each revoke restores acceptance. The
five-state rehearsal independently captures/dumps valid v0.1/v0.2 using this
predicate. Mocks remain supplemental Docker-capability tests only.

## Historical migration byte compatibility

Test-only fixtures materialize legitimate CRLF0000/0001 bytes from immutable Git
inputs and retain exact LF0002/0003 bytes. Hashes are calculated from actual bytes;
no tracked migration changes, real ledger edits or hash normalization occur.
Upgrade preserves original ledger/data UUIDs; repeat is unchanged. An alternate
LF history and deliberately corrupted isolated ledger fail the exact schema guard.
A full synthetic backup/restore also preserves the mixed history and schema.

Drizzle's migration executor alone is not the exact-history approval gate. Before
a future migration, require approved old-schema inventory/policy and a compatible
complete recovery point. A successful db:migrate does not authorize a mismatched
ledger. Final references must be regenerated from the selected exact tool/runtime
and actual historical byte path; these test policies are never production approval.
No real offsite recovery is claimed and no automatic ledger repair exists.
