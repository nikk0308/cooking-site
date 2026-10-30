# Phase 6.8 closeout — source-level engineering readiness

Decision: **Phase 6.8 CLOSED — source-level readiness. Phase 7 NOT STARTED.**
This decision is subject to this documentation PR's normal merge and successful
five-job post-merge CI. The final operator report records that merge/run. No
engineering or documentation acceptance authorizes production operations.

Verified implementation source after security merge:
`e51ee79c07eb74c85d1ae63ab0061e3cc755dc1b`, 30 October 2026.
Its [new post-merge CI](https://github.com/nikk0308/cooking-site/actions/runs/41064163713)
is SUCCESS: foundation, retention, Firefox, WebKit and backup-bridge all report
that exact head SHA. Actual logs, not only prior reports, were checked.
The documentation merge creates another SHA without changing this implementation;
neither SHA is an automatically approved RELEASE_SHA or TOOL_SHA.
Application package version remains `0.1.0`.

## Scope, criteria and evidence

Phase 6.8 stabilizes and validates the already implemented v0.2 public/personal
recipes, favorites, Shopping v2, catalog/admin/importer and personal portability.
It prepares versioned backup/recovery/rollback tooling and an executable release
plan. Completion requires all source-level tests and security gates, reviewed
documentation and green CI; installed-service and real production acceptance
are separate owner-authorized Phase 7 work.

| Source-level gate                                                    | Accepted evidence on the verified source                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain/functional integration and boundaries                         | 128 unit, 26 PostgreSQL integration; published-only reads, protected mutations, Decimal/units/nutrition and stable identities retained                                                                                                    |
| Browser-owned CRUD, Blob photos, favorites, shopping and portability | 49 regression + 4 release scenarios per Chromium/Firefox/WebKit; complete synthetic feature journey, no private outbound writes, atomic import/corruption/quota/stale-preview cases                                                       |
| Browser upgrade/export/import                                        | Nine source/target engine combinations PASS; explicit basket v1 migration/reconciliation preserves original bytes, repeated import/future rejection and restored photo hashes checked                                                     |
| Hydration and browser stabilization                                  | Hydration/scaling repeats and three additional independent cold WebKit journeys PASS; no hidden retries or inflated timeouts                                                                                                              |
| PostgreSQL 18.6 migration/ledger integrity                           | Clean install and 0000/0001 to 0002/0003 upgrade PASS; UUID/FK/data preservation, legitimate historical CRLF then LF history, mismatch rejection, history/drift checks; no historical SQL rewrite                                         |
| Complete inventory and schema                                        | Fourteen-table v0.2 inventory, provenance/source/receipts/revision, units/Drizzle ledger, constraints/FKs/indexes, pg_trgm, function and six revision triggers verified; incomplete/disabled objects rejected                             |
| Backup Bridge compatibility                                          | Actual isolated five-state capture/validation rehearsal PASS: old/old, old/new, new/new; new/old and unknown SHA/tool/schema/policy/target fail closed                                                                                    |
| Broker and dedicated read role                                       | 34 real PostgreSQL privilege cases PASS, including column/sequence/PUBLIC/ownership/CREATE/MAINTAIN/membership; capability/Unix peer/lock/interruption tests PASS; no arbitrary Docker/SQL/restore API                                    |
| Media permissions and image security                                 | Actual cross-UID Linux narrow ACL test PASS; 0640/exclusive reservation/atomic rename/cleanup retained; benign signature/decoder/SVG tests included in unit suite                                                                         |
| Runtime dependency security                                          | Fresh npm ci and production audit gate PASS, zero findings; actual runtime/maintenance version/native/RSC probes PASS, detailed acceptance below                                                                                          |
| Synthetic recovery and rollback                                      | Nine recovery tests PASS: full pg_dump/media/schema restore, CRLF/LF ledger, hashes/UUIDs/FKs/provenance/receipts/triggers; rebuilt v0.1 app-only rollback retains new schema/full inventory; synthetic exact-image/config roundtrip PASS |
| Offsite/retention failure boundaries                                 | Nine offsite gate tests and 44 retention tests PASS; persistent activation prevents legacy fallback; invalid/incomplete snapshot cannot reach encryption/upload/GC; no real Spaces operations                                             |
| Rebuild/runtime security                                             | Pinned Node 24.20.0, lockfile, Docker runtime/maintenance, Compose/Linux smoke PASS; UID10001/read-only/no-new-privileges/dropped-capability contract retained                                                                            |
| Shared-host isolation design                                         | Documented dedicated Culinote identities/paths/locks/resources and root-equivalent broker authority; no shared Docker restart, global Nginx/firewall or App Architector change; live isolation acceptance remains pending                 |

No mandatory gate was skipped. Failure-only diagnostics are correctly skipped on
success; the WebKit-only cold step is not applicable to the Firefox matrix job.
These are not waivers. Installed account/socket/ACL and daemon-side PostgreSQL
drain checks are not claimed by isolated client-process interruption tests.

Historical evidence remains available:

- [PR #9](https://github.com/nikk0308/cooking-site/pull/9) and
  [PR #10](https://github.com/nikk0308/cooking-site/pull/10): release-readiness
  integration and browser/privacy stabilization;
  [successful stabilization main CI](https://github.com/nikk0308/cooking-site/actions/runs/40898558126).
- [PR #11](https://github.com/nikk0308/cooking-site/pull/11): bridge preparation;
  [post-merge CI](https://github.com/nikk0308/cooking-site/actions/runs/41014412339).
- [PR #12](https://github.com/nikk0308/cooking-site/pull/12): media permissions;
  [validated post-merge attempt 2](https://github.com/nikk0308/cooking-site/actions/runs/41040158513/attempts/2).
- [PR #13](https://github.com/nikk0308/cooking-site/pull/13): broker privileges
  and historical ledger;
  [combined main CI](https://github.com/nikk0308/cooking-site/actions/runs/41053005775).
- [PR #14](https://github.com/nikk0308/cooking-site/pull/14): security correction;
  [reviewed PR CI](https://github.com/nikk0308/cooking-site/actions/runs/41061492841)
  and the distinct authoritative merged-source CI linked above.

## Security acceptance at the merged source

The 30 October audit and built-image checks establish this specific baseline,
not universal or future dependency safety. Production-tree npm audit reports
**zero findings**, including zero unresolved critical/high findings. Full audit
retains **eight dev-tool package entries: two high, six moderate**, no critical.
The [sanitized before/after inventory](security-audit-summary.json) and
[remediation report](security-remediation.md) retain advisory ranges, dependency
paths and the distinction between advisory count and affected-package count.

Selected versions: Next/eslint-config-next 16.4.1, React/DOM 19.2.9, Sharp 0.35.5,
application Zod 4.6.6 and transitive source-map-js 1.2.2. Independent copies are
checked, including deduplicated Sharp; updating React alone was not treated as
proof that bundled RSC was patched. Integrity-locked Next RSC/framework runtime
bundle bytes were checked in actual built images.

Runtime and maintenance probes executed with Node 24.20.0, UID10001, x64/glibc2.36,
read-only rootfs, no network/capabilities and no-new-privileges. Slim runtime
omits complete optional native component metadata, so the gate binds its actual
native library SHA256 to maintenance's identical binary and full metadata:
libvips8.18.7/librsvg2.63.2. Missing metadata or mismatched native bytes fails.
Bundled application Zod and Next's separate versionless trusted-config bundle
are explicitly inventoried, not silently conflated or assigned invented versions.

JPEG/PNG/WebP binary preflight precedes the application Sharp constructor;
unsupported SVG/XML and misleading MIME are rejected. Corrupt raster candidates
still require patched native validation, and the SVG loader is additionally
blocked. Rotation/resize/pixel/page limits, WebP hashes, authorization, mode/ACL
and failure cleanup remain tested. Framework patching also protects independent
Next/RSC handlers; admin upload authentication is not their mitigation.
No assertions, browser timeouts, retries, runtime privileges or public ports were
weakened/added by the correction.

Dev/build tools (including Vite/Vitest/mocker, brace-expansion and drizzle-kit's
legacy esbuild chain) remain a reported residual risk. Do not expose dev servers
or accept untrusted source/config/build inputs. Their presence in private
maintenance/tool environments is not an approved public runtime deployment.
Re-audit the exact future release inputs; new material findings are STOP gates.

## Urgent unresolved current-production security action

**Merging PR #14 did not patch production.** The source corresponding to the
reported deployed v0.1 revision `4f4807aa90c1bb52d6faaec5121f7c27bdada464`
locks Next16.3.3, React/DOM19.2.8 and Sharp0.35.4 associated with the advisories.
Running-image contents and exploitability remain UNVERIFIED. No production
inspection or exploit was performed during this closeout.

Separately authorized **urgent v0.1 security-hotfix consideration has priority over
optional product enhancements**. Prepare/review it only from that original
revision, without v0.2 functionality or schema. Preserve the nine-table v0.1
schema, historical 0000/0001, existing inventory, deployed-SHA backup guard
semantics, Docker/runtime interfaces and exact rollback/recovery protections.
A future hotfix cannot deploy before independent backup SHA-transition and
recovery-safety review; neither bypass the guard nor silently break backups.
No hotfix implementation, image acquisition or deployment is included here.

## Known limits and Phase 7 handoff — NOT STARTED

The historical WebKit-to-Firefox 60-second portability timeout remains
**intermittent, root cause UNVERIFIED**. The original
[failed attempt](https://github.com/nikk0308/cooking-site/actions/runs/41040158513/attempts/1)
is not erased by subsequent cold-run/controlled-rerun and final matrix PASS.
No permanent fix is claimed. A recurring failure requires evidence and diagnosis,
not unlimited retries, sleeps or weakened checks. WebKit CI is not real Safari/iOS
device acceptance.

The following are explicit Phase 7 owner-authorized gates, not completed source
proofs or implied permission to execute:

1. Urgent current-v0.1 security decision described above, live read-only preflight
   and exact running-image/configuration verification under separate permission.
2. Separately reviewed application version bump to `0.2.0`, new CI, explicit
   RELEASE_SHA and TOOL_SHA selection from clean reviewed sources; final immutable
   app/maintenance/Node/tool image/artifact identities, reference inventories and
   policy review. Historical `12fb36f...` predates media/security corrections and
   is not the current release candidate. No final policy/tag/freeze exists here.
3. Production UID/GID/groups/ACL and media-reader acceptance for existing/future
   files; immutable source/environment ownership and output/lock permissions.
4. Broker socket/security installation and explicit acceptance of its
   root-equivalent Docker authority, separate from the unprivileged runner.
5. Pinned Node host ABI/environment provisioning and real systemd credential-path,
   execution-identity and sandbox acceptance; templates remain inactive examples.
6. Dedicated PostgreSQL read-only role/credential installation and verification
   against the actual database, without new public ports or broad grants.
7. Daemon-side PostgreSQL operation drain checks, broker lifecycle and coordinated
   backup/upload lock acceptance before maintenance transitions; disappearing
   client locks alone do not prove Docker/PG operations finished.
8. Actual old application image/config preservation with verified immutable
   identity and private env/media mappings, rollback checkpoint and decision
   matrix. A CI rebuild or synthetic archive is not the actual old image.
9. Fresh pre-migration backup, protected recovery checkpoint and owner-assisted
   **real offsite decrypt/full restore**. Historical protected point
   `20261027T155249Z-012c8349-1a6e2ddc5110` was not modified; current live protection
   must be rechecked. Synthetic restore and ciphertext checks are separate proof.
10. Real Safari/iOS device acceptance and an explicit decision on any limitations.
11. Approved Culinote write-freeze and guarded inventory/SHA transition, migrations
    0002/0003 before new application traffic, v0.2 deployment, real local/offsite/
    watchdog/retention acceptance and shared-host/App Architector checks. Preserve
    [release ordering and STOP gates](release-runbook.md); app-only rollback keeps
    the new schema/full fourteen-table inventory. No destructive down-migration
    or automatic database restore is approved.
12. **Explicit approval for every production mutation**, including any rollback.
    Real release-bound offsite recovery remains PENDING_OWNER_AUTHORIZATION.

This documentation adds no production health assertion. Production remains on
the reported v0.1 release, and its real state must be re-established before any
authorized action. Phase 7 is production installation, recovery, deployment and
acceptance; none of it is started by closing engineering readiness.

Production mutations = 0; production migrations = 0; backup/GC/timer changes = 0;
App Architector modifications = 0. No production SSH, secrets/identity access,
service restart, real snapshot/restore, image acquisition/publishing, release
policy activation or version bump was performed.
