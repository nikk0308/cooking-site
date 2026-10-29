# Catalog import v1

Implemented in Phase 6.7. Fixtures in `public/catalog-import-example.json`, `public/catalog-import-template.csv` and `tests/fixtures/catalog-invalid.json` are synthetic test data, not nutritional reference data. No URL in a file is fetched.

## Envelope and records

JSON is strict UTF-8: `application: "culinote-catalog"`, `schemaVersion: 1`, `namespace` (1–128 lowercase ASCII letters/digits/dot/underscore/hyphen; starts alphanumeric), optional `batch` checkpoint label (256 characters), `records` (1–500). Unknown properties and future versions are rejected. Limit: 1 MiB before decoding. Invalid UTF-8, NUL and malformed files are rejected.

Each record has required `externalId` (1–256 characters), `name` (1–256), optional lowercase ASCII `slug` (256), `category: null | {name, slug}`, `aliases: string[]`, `nutrition: null | profile`. External ID is an opaque source ID, not a display name. Namespace must identify a stable dataset, not a new timestamp for every run. Missing nutrition is `null`.

Source IDs with leading/trailing whitespace are rejected rather than silently trimmed. Unchanged alias UUIDs are retained; ordinary alias spelling/case edits with the same normalized key preserve their UUID as well.

Profile fields: `basisQuantity`, `basisUnit` (existing unit code), `caloriesKcal`, `proteinG`, `fatG`, `carbohydratesG`, `sourceKind`, `sourceNote`, `sourceUrl`, `sourceIdentifier`. All five numeric values are **strings**: at most 12 integer and 6 fractional digits, dot separator, no exponent/comma/sign. Basis must be positive; nutrients may intentionally be zero. Every nutrient is mandatory when a profile exists. No conversion or fabricated values. `sourceKind`: UNKNOWN / MANUAL / REFERENCE / IMPORT. IMPORT requires a nonempty supplied sourceIdentifier. SourceNote is bounded to 1000 characters; URL to 2048 and HTTP(S) without embedded credentials; identifier to 256. URLs are metadata only.

Aliases are normalized with existing NFKC/lowercase/ё→е/whitespace rules. Up to 40 supplied aliases and 20 distinct normalized aliases. Redundant import aliases are deduplicated with a preview notice; manual CRUD rejects duplicates. Shared aliases across different UUIDs retain ambiguity.

## CSV

Only comma-delimited UTF-8, optional BOM, LF or CRLF. RFC-style quoted fields, escaped double quotes and embedded newlines are supported. No guessing delimiters/decimal commas. Exact ordered columns:

```text
schemaVersion,namespace,externalId,name,slug,categorySlug,categoryName,aliases,basisQuantity,basisUnit,caloriesKcal,proteinG,fatG,carbohydratesG,sourceKind,sourceNote,sourceUrl,sourceIdentifier
```

Every row uses schemaVersion `1` and the same namespace. Aliases is a JSON array inside the CSV cell (quote correctly), or an empty cell for none. Category fields both empty mean null. All ten nutrition/provenance cells empty mean null; otherwise a complete valid profile is required. Empty sourceUrl/sourceIdentifier become null. Max CSV cell 16000 characters. Empty physical rows are not silently skipped. A report is UTF-8 CSV with quoted cells and leading spreadsheet-formula characters neutralized; reports are not import files.

## Preview, decisions and application

The protected UI uploads the exact file for preview and again for apply. Preview runs in a read-only repeatable-read database transaction. It classifies every row CREATE / UPDATE / UNCHANGED / CONFLICT / INVALID, shows row numbers, reasons, candidate UUIDs, before/after fields and nutrition provenance, and affected categories/aliases/profiles. No invalid rows are silently accepted. All INVALID/CONFLICT rows block the entire part.

Fingerprint SHA-256 binds exact file bytes (including whitespace/BOM), format, explicit decisions, complete computed plan and catalog revision. The server does not accept browser-computed operations. Apply serializes catalog writes with an advisory lock, locks the revision, recomputes all operations and requires the exact fingerprint. A changed file, catalog/category/alias/nutrition/unit/source mapping or decision requires fresh preview. Statement-level database triggers advance revision even for ordinary direct SQL writes. Auth session heartbeat is outside the read-only catalog transaction.

Identity policy:

- `(namespace, externalId)` has a durable UUID mapping; UUID proposal derives from those source fields, never from normalized names. Missing slug gets a deterministic `source-<hash>` proposal. Existing mapped slug remains stable; import cannot rename it.
- An unrelated existing slug is a conflict. A matching normalized name/alias is ambiguous: fix the file, explicitly choose DISTINCT, or explicitly link a manually managed UUID. Linking creates LINK_ONLY: no fields/nutrition are overwritten, and future source changes remain informational. Each ingredient has at most one source mapping; adopting another source's product is rejected.
- SOURCE records may update the same UUID if its current canonical fields still match the last applied snapshot. A manual change requires explicit KEEP or REPLACE after comparison. KEEP preserves the manual state; REPLACE authorizes this source to replace it. Data owned by a different external mapping cannot be silently overwritten.
- Identical reruns are UNCHANGED: no ingredient/alias/nutrition rewrite, no timestamp changes, no new audit record. IDs and recipe FKs remain intact.

Each file is one atomic transaction, maximum 500 rows. A failure in any row rolls back ingredients, categories, aliases, nutrition, source mappings, revision and audit receipt together. Successful changed parts produce `catalog_import_runs` receipts with file/plan hashes, counts, source IDs and resulting UUIDs, not full uploaded datasets. Download the UI result report. Interrupted/uncertain apply: preview again; committed rows become UNCHANGED, uncommitted rows remain proposed.

Large datasets must be split into bounded files/parts, preferably with JSON `batch` labels. Confirm and commit each part separately. Prior successful parts remain committed if a later part fails; this is **partial dataset progress**, never all-or-nothing for multiple files. Retain file hashes/result reports as checkpoints, fix/retry the failed part using stable source IDs. There is no unattended multi-part uploader or destructive replace mode.

## Optional CLI

Uses the same parser/planner/transaction service. Explicit `--database` is mandatory; environment DATABASE_URL is never a fallback. Examples are for a disposable local database only; never paste production credentials into commands or shell history.

```powershell
npx tsx scripts/catalog-import.ts --database $disposableDatabaseUrl --file public/catalog-import-example.json --format json
# After reviewing this exact preview, explicitly pass its hash:
npx tsx scripts/catalog-import.ts --database $disposableDatabaseUrl --file public/catalog-import-example.json --format json --apply $reviewedPlanHash
```

Optional `--decisions path.json`: object keyed by externalId with DISTINCT / KEEP / REPLACE or `{ "link": "uuid" }`. Changing decisions invalidates prior approval. No default apply and no production execution in this phase.
