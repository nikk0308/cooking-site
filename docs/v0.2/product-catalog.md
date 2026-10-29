# Product catalog foundation

## Phase 6.7 implementation

`ingredients` is still the single catalog. Additive migration 0003 introduces `catalog_source_records` (durable source identity and last-applied canonical hash), `catalog_import_runs` (committed part receipts), `catalog_revision` and statement-level revision triggers. Existing UUIDs/slugs/FKs/provenance remain unchanged. Historical 0000/0001/0002 are immutable.

Protected routes: `/admin/categories`, `/admin/ingredients` (50-row keyset pages, search/category filter and one create form), `/admin/ingredients/[id]` (single edit), `/admin/ingredients/import`. Category delete locks/checks the row and refuses used categories despite the existing SET NULL FK. Alias count is bounded; normalized duplicates per ingredient are rejected. Nutrition enable starts empty, complete values are validated individually, explicit removal is confirmed, omitted unrelated fields preserve saved provenance. Public catalog remains bounded/read-only; recipe admin now searches at most ten candidates and separately loads existing selected UUIDs.

Search uses parameterized candidate-ID UNION over canonical names and aliases. At 3+ normalized characters it is substring search with pg_trgm GIN; at 1–2 characters it is prefix search with text_pattern_ops indexes. `%`, `_` and backslash are literal. Stable normalized-name/UUID cursor avoids OFFSET/full-form loading. No name-based identity merge.

Measured on isolated PostgreSQL 18, 20000 synthetic ingredients plus 20000 aliases: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for `%alias-benchmark-19999%` changed from two sequential scans (5.432 ms, 574 shared-hit blocks) to two bitmap GIN index scans (1.455 ms). A selective prefix query uses the prefix B-tree. These single local observations are not a production latency SLA; common/broad terms can legitimately select sequential scans. Reproduce with `tests/integration/catalog-search-benchmark.test.ts --disableConsoleIntercept`. No production benchmark/data writes occurred.

Full import schema, collision/precedence policy, transaction/checkpoint boundaries and CLI: [catalog-import-schema.md](catalog-import-schema.md). Disposable owner instructions: [catalog-owner-walkthrough.md](catalog-owner-walkthrough.md).

The following sections describe earlier milestones; their future-work notes are superseded by the Phase 6.7 implementation above.

Existing `ingredients` remains the sole shared product catalog. Stable UUIDs/slugs, existing recipe FKs and `ingredient_nutrition` are preserved.

Migration 0002 adds:

- ingredient_categories: UUID, unique slug, normalized unique category name.
- ingredients.category_id (nullable, SET NULL on category deletion) and indexed generated normalized_name.
- ingredient_aliases: UUID, ingredient FK, name and generated normalized_name, unique per ingredient/normalized alias. Different products may share an alias; lookup returns ambiguity, never merges them.
- ingredient_nutrition source_kind (UNKNOWN default, so legacy origin is not invented), source_url and source_identifier; source_note is retained. MANUAL/REFERENCE/IMPORT classify explicitly supplied provenance. Unknown origin does not erase known nutrient values. Profiles remain optional as whole records; missing nutrition is null, not zero.

Normalization: NFKC, lowercase, ё->е, collapsed whitespace, trimmed ends. PostgreSQL generated columns prevent stale keys when existing admin operations rename products. Browser/search normalization has matching integration fixtures. Stable identity does not derive from this display/search key. Search treats `%`, `_` and backslash literally and uses parameterized SQL.

`catalogRepository` is intentionally read-only: bounded name/alias search (1–50 rows), category filter, up to 100 requested UUIDs/aliases and 200 categories. Current substring lookup may scan; Phase 6.7 must add measured indexing/pagination before large imports. There are no new public mutation routes. Existing ingredient admin POST still requires session and same-origin validation; old saves leave category/provenance extension fields intact.

No brands, prices, store SKUs or package model are introduced. Phase 6.7 bulk import must target these tables, reuse normalization, preserve UUIDs, validate units/source provenance and provide dry-run/conflict reports with transactional application. Import is not implemented in Phase 6.4.

Phase 6.5 exposes explicit bounded read-only search at `GET /api/catalog?query=...` (maximum ten results). Personal recipe selection snapshots the catalog identity and compatible nutrition including basis unit/source. Manual personal products never create PostgreSQL entries. Administration/import remains Phase 6.7.
