# Browser storage and privacy

Entry point: `src/platform/browser/foundation.ts`. Call `openBrowserRepository()` explicitly in a browser. Default database: `culinote-browser`, physical version 2; records have independent schemaVersion fields.

Stores:

| Store     | Key          | Content                                                         |
| --------- | ------------ | --------------------------------------------------------------- |
| recipes   | reference.id | LOCAL RecipeDocument v1                                         |
| photos    | id           | v1, recipeId, Blob                                              |
| documents | key          | v1 envelope containing favorites, shopping or migration receipt |

Phase 6.6 uses the same stores and physical version 2. `shopping:undo` holds one internal before/after shopping checkpoint; it is atomic with clear/source edits and restores only if the current list still equals the saved post-action state. Migration receipts may include `originalRaw` to retain the first v1 source after explicit reconciliation. Neither internal record is part of the portable export. `repo.shopping.view()` reads shopping/revision/checkpoint consistently, without requiring photo assets to render a shopping list. There is no destructive storage upgrade or new localStorage shopping document.

Physical version 1 has recipe/document stores; version 2 adds photos. Upgrades only create missing stores and verify existing key paths. They never delete, rewrite or clear existing records. A failed upgrade aborts atomically; incompatible/future schemas require explicit recovery instead of destructive reset. Existing connections close on versionchange. Blocked upgrades are reported and can be retried after another tab closes.

Recipe and owned photo changes, duplication and deletion are single readwrite transactions. Save requires the complete asset set; the editor reads and passes existing Blobs. An optional expected document prevents stale editor writes. Blob IDs cannot be reassigned between recipes. Local recipes are capped at 500. Read/update rejects corrupted or unsupported records without overwriting them. Favorites/shopping updates serialize through IDB transactions, including across tabs.

Phase 6.5 validates image signatures, header dimensions and actual browser decoding before saving/importing/exporting: JPEG/PNG/WebP, at most 10 photos/recipe, 10 MiB/photo, 8192 pixels per side and 16 megapixels. Animated PNG/WebP are rejected. Original bytes and metadata (including possible location/EXIF information) are preserved, without server processing. Display Object URLs are revoked on replacement/unmount; they are never stored.

Every adapter write increments a revision in the documents store within the same transaction. Import previews capture that revision; confirmation aborts if any adapter write happened meanwhile. BroadcastChannel carries only a change signal, and focus refresh provides a fallback. Legacy tabs running older code cannot participate in this guard: close them before import. IndexedDB database version remains 2; no destructive migration was added.

Errors: UNAVAILABLE, QUOTA, CORRUPTED, UNSUPPORTED_VERSION, UPGRADE_FAILED, BLOCKED, VERIFY_FAILED, CAPACITY. Callers must display recovery guidance, not clear storage on failure. `requestPersistence()` explicitly requests the browser's persistence grant, which may be refused. IndexedDB survives reload but is not a remote backup: browser eviction, profile deletion and device loss remain risks. Browser data is origin/profile scoped, not protected against same-origin XSS or another person using that profile.

The adapter contains no fetch, upload, analytics or Object URL persistence. PUBLIC resolution is a separately supplied/read-only service; local recipe/photo objects are never sent automatically. Privacy is asserted by browser tests observing no outbound writes during repository operations.

Portable export contract: `src/platform/browser/export-contract.ts`, application `culinote`, schemaVersion 1, createdAt, local recipe documents, favorites, shopping and owned photo payloads `{schemaVersion:1,id,recipeId,mimeType,encoding:base64,data}`. Phase 6.5 implements full export from one consistent readonly transaction. Duplicate/orphan/missing assets fail explicitly; no records are omitted. File limit 64 MiB, total decoded photo limit 40 MiB, export text metadata limit 16 MiB. Large libraries must remain intact when export fails; splitting/streaming export is future work.

Import checks size before reading, the full strict envelope, canonical Base64/decoded bounds, ownership and real images. A preview precedes explicit confirmation. New identities are added, identical recipes/photos skipped (photo equality includes SHA-256 of bytes), favorites union by namespaced reference. Different existing recipes/photos block the entire import. Different nonempty shopping documents block it too; an empty incoming document never clears an existing list. Import-as-copies is not supported. Use a separate browser profile to restore a conflicting backup after exporting current data. All required stores commit atomically; quota, stale preview and transaction abort leave previous records intact. No temporary URLs, credentials, old basket v1 or unrelated localStorage values enter the file.
