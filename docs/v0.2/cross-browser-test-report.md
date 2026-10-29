# Browser validation matrix

The workflow keeps foundation/retention and adds a bounded Firefox/WebKit matrix.
Each engine runs all 49 existing E2E cases and four release cases. Foundation
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

WebKit intentionally rejects IndexedDB Blob writes in ephemeral/private sessions
([upstream issue](https://bugs.webkit.org/show_bug.cgi?id=286561)). The initial
Linux job exposed this as UnknownError, mapped to UNAVAILABLE, rather than a
missing normal-browser capability. Regular WebKit flows now use separate
task-created persistent profiles; no existing profile is opened. A separate
private-context test still executes on all engines and verifies explicit WebKit
failure, rollback of the whole recipe/photo write and preservation of previous
records. Chromium/Firefox retain their standard contexts. Nine-engine transfers
also use regular WebKit profiles. This is not a skipped photo test or a change
to Blob storage format. Private WebKit photo persistence remains unsupported;
the UI advises checking private mode and never reports a failed save as success.
Severity: documented private-mode restriction, not a normal-profile release
blocker once regular-profile and atomic rejection tests pass. Real Safari/iOS
device testing remains distinct from Playwright's Linux WebKit evidence.

The first Linux run also exposed Next development-mode full reloads when shared
client modules compiled for a route for the first time. Readiness/URL alone did
not prevent an outstanding reload from interrupting a later navigation. The
test server now compiles the actual public/admin routes using bounded read
requests and consumes their responses before browser tests start. It authenticates
only against the runner's randomly named isolated fixture, does not bypass
authorization, and suppresses no navigation failure. User links remain tested.

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
