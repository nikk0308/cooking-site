# WebKit release journey diagnostics

## Reproduced failure

The integrated journey's step 06 lost its unsaved personal recipe form during
development-server navigation. A cold Linux WebKit run stopped at **06.05 Open
catalog picker**: the summary was resolved, then detached. CI run
[40891040460](https://github.com/nikk0308/cooking-site/actions/runs/40891040460)
stopped at **06.06 Search catalog**, with the search button detached. Its other
49 WebKit regression cases and three release cases passed.

Both anonymous traces showed `beforeunload`, another document GET of
`/my-recipes/new`, and HMR reconnecting. The failure screenshot showed a fresh
empty editor. This preceded photo selection and IndexedDB save; it was not a
slow Blob transaction. Cleanup completed independently of the business failure.

Next 16.3.3's development `hot-middleware.js` broadcasts `SYNC` when an HMR
client connects. Its client `web-socket.js` reloads an existing document when a
subsequent sync carries a different compilation hash. Keeping the idle admin
document alive allowed this background development activity to reload the
visitor's dirty form. Precompiling routes alone did not eliminate that race.

## Scoped correction

After admin UI/media setup, navigate the idle admin page to `about:blank` before
creating the visitor profile. Later admin checks still use the same authenticated
request context and assert their persistence and publication results. No session
is copied into visitor or restored contexts. No application request, dialog,
storage write or HMR message is mocked. Application source is unchanged.

The complete journey remains one test. Its original business assertions and
180-second overall limit remain. Bounded 15-second setup and editor substeps
identify the first incomplete operation, leaving time to persist anonymous
diagnostics before teardown. Cleanup failures have their own diagnostic field.
There are no sleeps, automatic retries or increased timeouts.

## Diagnostic privacy

Admin-context tracing is disabled. Only disposable anonymous visitor/restored
contexts are traced; input and textarea values are masked in explicit screenshots.
Diagnostic JSON records fixed checkpoints and bounded metadata, not headers,
request bodies, console text or credentials.

A deliberately failing **local disposable copy**, after all normal business
assertions, produced visitor/restored traces for inspection. The exact allowed
six diagnostic files passed the scanner. The intentional failure is absent from
repository tests and from the disposable test copy after validation. Raw traces
contained no admin login requests, credential input actions or admin-session
headers. The independent positive canary fixture deliberately injects a synthetic
credential marker and verifies rejection without printing its value.

Before CI upload, `scripts/ci/check-release-diagnostics.py` rejects credentialed
admin requests/headers, credential input actions, synthetic canaries, known private
key markers, unexpected diagnostic files and excessive archive sizes. Its three
unit tests include positive rejection and the cold-run directory edge case.
This is defense in depth for synthetic diagnostics, not a general secret scanner.

Uploads select only `release-diagnostics.json`, `release-*-trace.zip`, and
`release-*.png` files. Never upload a `release-*` directory recursively: cold-run
directories also have that prefix and contain unmasked Playwright artifacts.
Publication requires a successful privacy check; retention is one day.

## Reproduction and acceptance

Use the existing isolated PostgreSQL 18 launcher on supported Linux, with the
lockfile's Playwright browsers installed:

```sh
E2E_BROWSER=webkit npm run test:e2e -- --config=playwright.release.config.ts --grep 'admin/catalog/public/private/favorites/shopping/photo backup restore integrate without private writes'
python -B -m unittest discover -s scripts -p test_release_diagnostics.py -v
python scripts/ci/check-release-diagnostics.py test-results
```

CI runs all regression/release cases and three additional independent cold
WebKit journeys, stopping on the first failure. Each launcher invocation creates
a fresh synthetic database and disposable browser profiles. Require all four
jobs on the final PR head; an earlier successful control is insufficient.
Production access, deployment, backup changes and real offsite recovery are
outside this correction.
