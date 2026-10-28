# Product catalog foundation

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
