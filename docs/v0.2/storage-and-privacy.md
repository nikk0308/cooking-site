# Browser storage and privacy

Entry point: `src/platform/browser/foundation.ts`. Call `openBrowserRepository()` explicitly in a browser. Default database: `culinote-browser`, physical version 2; records have independent schemaVersion fields.

Stores:

| Store     | Key          | Content                                                         |
| --------- | ------------ | --------------------------------------------------------------- |
| recipes   | reference.id | LOCAL RecipeDocument v1                                         |
| photos    | id           | v1, recipeId, Blob                                              |
| documents | key          | v1 envelope containing favorites, shopping or migration receipt |

Physical version 1 has recipe/document stores; version 2 adds photos. Upgrades only create missing stores and verify existing key paths. They never delete, rewrite or clear existing records. A failed upgrade aborts atomically; incompatible/future schemas require explicit recovery instead of destructive reset. Existing connections close on versionchange. Blocked upgrades are reported and can be retried after another tab closes.

Recipe and owned photo changes, duplication and deletion are single readwrite transactions. Save requires the complete asset set, preventing accidental loss from omitted blobs. Blob limits: 10 photos/recipe, 10 MiB/photo, JPEG/PNG/WebP; metadata is validated, not a full image decoder. Blob IDs cannot be reassigned between recipes. Local recipes are capped at 500. Read/update rejects corrupted or unsupported records without overwriting them. Favorites/shopping updates serialize through IDB transactions, including across tabs.

Errors: UNAVAILABLE, QUOTA, CORRUPTED, UNSUPPORTED_VERSION, UPGRADE_FAILED, BLOCKED, VERIFY_FAILED, CAPACITY. Callers must display recovery guidance, not clear storage on failure. `requestPersistence()` explicitly requests the browser's persistence grant, which may be refused. IndexedDB survives reload but is not a remote backup: browser eviction, profile deletion and device loss remain risks. Browser data is origin/profile scoped, not protected against same-origin XSS or another person using that profile.

The adapter contains no fetch, upload, analytics or Object URL persistence. PUBLIC resolution is a separately supplied/read-only service; local recipe/photo objects are never sent automatically. Privacy is asserted by browser tests observing no outbound writes during repository operations.

Portable export contract: `src/platform/browser/export-contract.ts`, application `culinote`, schemaVersion 1, createdAt, local recipe documents, favorites, shopping and owned photo payloads `{schemaVersion:1,id,recipeId,mimeType,encoding:base64,data}`. Duplicate/orphan/missing photo identities are rejected. The future importer must additionally bound decoded bytes, validate image content, perform all-or-nothing writes and retain old data on rejection; a complete export/import workflow is deferred. No temporary URLs, credentials or server personal data belong in this envelope.
