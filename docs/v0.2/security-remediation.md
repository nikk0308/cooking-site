# Phase 6.8 security correction — not release approval

Base source: `4cb6a77e6c35ae9cef9ad6e95b074e570da82ddf`.
This correction alone did not close Phase 6.8 or authorize production operations.
Application version remains `0.1.0`.

## Merged-source security acceptance — 30 October 2026

[PR #14](https://github.com/nikk0308/cooking-site/pull/14) merged as
`e51ee79c07eb74c85d1ae63ab0061e3cc755dc1b`.
[New security post-merge CI](https://github.com/nikk0308/cooking-site/actions/runs/41064163713)
passed all five jobs, including fresh npm ci, zero production audit findings and
actual runtime/maintenance native/RSC/SVG probes. The residual dev-tool findings
below remain reported, not suppressed or universally declared safe. Overall
closure and production-only gates are in the [Phase 6.8 closeout](phase-6.8-closeout.md).
No production software was patched by this merge; the urgent v0.1 action below
remains unresolved. The baseline and initial correction evidence are retained.

## Runtime baseline and selected corrections

The accompanying [sanitized audit inventory](security-audit-summary.json) records
advisory IDs, ranges, severities and dependency paths. Audit package totals are
not advisory totals: the single critical `next` package entry had eleven
advisories, including three critical advisories. No exploit was executed.

| Dependency                   | Locked before | Selected | Reason / origin                                                                                   |
| ---------------------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Next.js / eslint-config-next | 16.3.3        | 16.4.1   | Minimum upstream October security release; matching lint integration                              |
| React / React DOM            | 19.2.8        | 19.2.9   | Compatible 19.2 patch baseline; RSC advisory must also be addressed by Next's bundled server code |
| Sharp                        | 0.35.4        | 0.35.5   | Patched native librsvg; one deduplicated Sharp copy, including Next's optional image dependency   |
| Zod                          | 4.5.4         | 4.6.6    | High resource-exhaustion advisory, GHSA-mrhx-c7xc-m3w5                                            |
| source-map-js                | 1.2.1         | 1.2.2    | High source-map DoS, GHSA-68fv-2mgg-jv7q; transitive through Next/PostCSS (also used by dev Vite) |

These are deliberately minimal verified patched releases, not a major upgrade or
an unbounded dependency refresh. `source-map-js` is updated through its existing
compatible transitive constraint, not an unrelated new direct dependency.
Node 24.20.0/base digests, application version and migration history are unchanged.

Next also vendors a Zod-v3-API config/build bundle without a package version at
`next/dist/compiled/zod`. It is not the root application Zod instance. Next's
config-schema, segment/middleware config, build analysis and development MCP
tools use it with trusted source/configuration; application request/import
schemas import the separately patched root Zod. The image probe verifies this
exact bundle's code/package hashes against the locked Next package and reports
the distinction, rather than inventing a version or suppressing arbitrary nested
copies. Never supply untrusted Next configuration/build inputs; this internal
bundle is not accepted as a general-purpose untrusted-data validator.
Application Zod is inlined into standalone server chunks by Webpack; it need not
have a copied package.json there. The runtime probe records emitted 4.6.6 version
markers and chunk hashes alongside the lockfile audit. Any independently
installed copies remain subject to the normal version checks; maintenance keeps
and checks its actual application Zod package.

Source production-tree audit after correction: **zero findings**. Full audit:
eight dev-tool package entries (two high, six moderate), no critical. They concern
Vite/brace-expansion and Vitest/mocker plus drizzle-kit's legacy esbuild chain.
They are not waived as safe: do not expose dev/test servers to untrusted networks
or accept untrusted build inputs. Maintenance/tool environments contain these
development dependencies; their private, trusted operator execution remains a
separate threat model. No `audit fix`, force update or suppression is used.

## Framework exposure and upstream evidence

- [October 14 update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
  requires patching even without similar application cache functions.
- [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
  and [Sharp/librsvg](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)
  cover image processing on glibc Linux. Official Node is non-PIE in the observed
  isolated environment; this correction patches the library rather than assuming
  the runtime hardening changes that upstream warns about.
- [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
  / [React RSC](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3)
  require framework-side fixes, not merely updating React DOM. Next 16.4.1 ships
  the upstream fixes. Its vendored RSC peer label remains
  `19.3.0-canary-278794d7-20261002`; that is not an independently installed stable
  react-server-dom package or sufficient evidence by itself. The runtime gate
  hashes shipped production RSC files against the integrity-locked patched Next
  package used during the build, in both runtime and maintenance images.
  Standalone embeds RSC in `compiled/next-server/app-page.runtime.prod.js` rather
  than necessarily copying each RSC cjs file. The probe verifies those actual
  framework runtime bundle hashes (and separate RSC files when present), requiring
  the App Router RSC runtime, not treating absent standalone cjs files as proof.
- [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
  is conditional on Server Actions; absence of `use server` is observed in this
  source, but is not a substitute for the patched framework.

Both old and current source use App Router/RSC. No explicit next/image,
ImageResponse, Server Actions, Cache Components or `use cache` usage was found.
However, the built-in `/_next/image` handler exists independently of importing
next/image. Neither config explicitly disables optimization. Framework defaults
deny remote images and SVG responses, permit local images, and do not themselves
prove that every attacker-controlled decoder input is unreachable. No public
attacker-controlled SVG source was established by this source-only review.
Admin-upload authentication protects that upload route, not independent framework
request handlers or RSC processing. All affected framework dependencies are
therefore patched rather than dismissed based on route/component grep alone.

## Decoder boundary and regression contract

`storeImage` rejects size violations and unsupported binary signatures before
constructing a Sharp pipeline. Only JPEG (FF D8 FF), PNG's full eight-byte magic,
and RIFF/WEBP with a recognized VP8/VP8L/VP8X chunk are candidates. MIME type and
filename confer no trust. The patched decoder must then confirm the same format,
dimensions, pixel limit and a single page. Signatures are not a custom decoder
and do not make corrupted raster data valid.

The module also blocks `VipsForeignLoadSvg` using the upstream Sharp API before
any of its parsing operations. A real native metadata call on benign SVG must
fail. Unsupported-format tests instrument the constructor to prove it was never
invoked; SVG mislabeled JPEG must reach neither native parsing nor DB insertion.
Corrupt/truncated raster, XML/TIFF/PDF/GIF, oversized input, pixel overflow,
animated WebP and PNG-signature/SVG mixtures are covered with benign fixtures.

Raster acceptance, orientation, resize, WebP metadata/hashes, 0640/narrow ACL,
exclusive reservation, atomic rename, foreign-file preservation and failed-DB
cleanup remain required. Browser-owned photo storage and authorization are unchanged.

## Reproducible acceptance

Use the exact clean source and pinned Node 24.20.0, in isolation only:

```sh
npm ci
npm audit --omit=dev --json
npm audit --json # dev findings reported separately, not silently ignored
npx vitest run tests/unit/media-security.test.ts tests/unit/media-storage.test.ts
docker build --tag recipes:readiness .
docker build --target maintenance --tag recipes:readiness-maintenance .
node scripts/ci/runtime-security.mjs
```

The mandatory Foundation job includes the production advisory gate and actual
built-image probe, not only a developer node_modules check. The probe runs
network-disabled, UID10001, read-only, cap-drop ALL, no-new-privileges and bounded
resources. It checks every discovered security-package instance, native
Sharp/libvips/librsvg, real raster decoding/SVG blocking, Node/ABI/ELF metadata,
absence of dev servers in standalone runtime, and vendored RSC hashes. It prints
image IDs and safe version evidence, never env values. No lockfile inside the
slim runtime is assumed. Existing smoke tests check app startup/security flags.
Standalone Sharp may omit optional native component `versions.json`, reporting
only Sharp/libvips. That absence is explicitly recorded, never called a patched
librsvg proof. Both probes hash the actual loaded-platform libvips binary; the
outer gate requires identical runtime/maintenance native bytes and patched full
component metadata from maintenance. Missing reference metadata or any binary
mismatch fails closed. This avoids adding packages or privileges to slim runtime.

All five CI jobs and the complete existing integration/browser/portability,
ACL/privilege, five-state/recovery/rollback/offsite/retention checks remain
mandatory on the final PR head. A green earlier source is not acceptance.
The historical portability timeout remains intermittent / root cause UNVERIFIED;
no extra retries or increased timeouts are introduced here.

## Current v0.1: separate urgent hotfix proposal

Git inspection of deployed-source reference
`4f4807aa90c1bb52d6faaec5121f7c27bdada464` confirms the same old Next16.3.3,
React/DOM19.2.8 and Sharp0.35.4 lock entries, default image config, App Router and
metadata-before-format rejection. This is potential current public-app exposure,
not proof of running image contents, successful exploitation, or compromise.
No production request, SSH, image acquisition or deployment was performed.

Recommend urgent separately authorized preparation of a v0.1 security-only branch
from that exact revision: patched compatible runtime dependencies/lock/lint,
the small pre-decoder signature/SVG-blocking correction and its focused tests.
Re-evaluate that branch's own complete runtime audit and actual disposable image;
do not copy the v0.2 lockfile wholesale or cherry-pick v0.2 functionality/schema.
Preserve 0000/0001, UUIDs, deployed backup inventory/guards and service contracts.
Any future app SHA change must first have a separately reviewed compatible backup
guard transition: the installed hardcoded SHA must neither be bypassed nor left
silently breaking daily backups. No bridge installation is implied by this proposal.

That hotfix requires independent review, exact-image/source verification,
rollback/recovery checkpoint and explicit owner deployment authorization. This
PR is not that branch or authorization. Production remains unchanged, and no
RELEASE_SHA/TOOL_SHA, tag, policy, real recovery proof or Phase 7 is created.
