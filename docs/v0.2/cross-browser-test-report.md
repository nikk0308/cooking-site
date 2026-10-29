# Browser validation matrix

The workflow keeps foundation/retention and adds a bounded Firefox/WebKit matrix.
Each engine runs all 49 existing E2E cases and three release cases. Foundation
runs Chromium plus all nine Chromium/Firefox/WebKit backup-transfer pairs. A pair
exports actual Blob data through the UI, restores into a separate engine/context,
checks IDs/quantities/photo-byte hashes, repeats import, rejects a future schema
without mutation, and verifies no private backend writes. Older supported
version-1 envelopes remain readable. Tests never use real profiles.

Local evidence before CI:

| Check                                                 | Local result                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Firefox IndexedDB/storage/migration suite             | 8 PASS                                                              |
| Chromium complete journey plus notification fallbacks | 3 PASS                                                              |
| Full three-engine matrix / nine transfers             | Mandatory Linux CI; check exact PR head                             |
| Windows WebKit                                        | BLOCKED: installed browser requires icuin77.dll absent on this host |

No WebKit test is skipped or replaced with Chromium. Supported Playwright Linux
installation uses `install --with-deps webkit`; missing host DLLs are not repaired
using arbitrary downloads. Linux CI PASS is required before review readiness.

## Findings

`setInputFiles` does not wait for enabled state. The initial interrupted journey
and its subsequent corrupt-file case interacted before repository initialization.
The production input correctly starts disabled. Harness now asserts enabled
before upload; no timeout increase, sleep or weakened corruption assertion.

Cross-engine execution also exposed Firefox restoring dynamic disabled states
across reloads, producing a React hydration mismatch and Next development stack
requests. The portability form now opts out of browser form-state restoration
with autocomplete=off; buttons are explicitly non-submit. Tests retain the
strict no-outbound-writes assertion, including these unexpected requests.

BroadcastChannel absence/constructor denial is covered by focus refresh;
visibility refresh also supports returning mobile tabs. This is local notification,
not network synchronization. Background suspended tabs refresh when made active.
Browser storage can still be evicted by browser/OS policy; user exports are vital.

Full legacy migration tests remain in the existing suite: malformed/future v1,
explicit confirmation, retained original bytes, receipts/partial failures,
LEGACY_CHANGED conflict reconciliation, quota failures and cross-tab updates.
No automatic migration or destructive storage reset was added.
