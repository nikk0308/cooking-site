# Backend v0.2 delivery boundaries

Base: `cea6a08d454a7812b83bed4e24302dcd884b6b38`. Production remains v0.1.

Implemented foundation:

- Common versioned recipe documents, PUBLIC/LOCAL references and catalog/local product identities.
- Native IndexedDB repository: local recipe CRUD/duplication, persistent Blob photos, favorites and shopping documents.
- Safe, explicit migration of `recipes:basket:v1`, including transaction abort and verification retry.
- Additive catalog categories/aliases/search and structured nutrition provenance using existing ingredients/nutrition tables.
- Shared Decimal, unit conversion, scaling, basket aggregation and nutrition services, reused by new shopping/document adapters.
- Unit, PostgreSQL upgrade/integration and real Chromium persistence tests. Existing v0.1 tests remain.

Phase 6.4 supplied these contracts and repositories. Phase 6.5 adds personal recipe screens, favorite controls, mixed favorites, bounded public/catalog reads and complete browser export/import. The provider opens IndexedDB after hydration without migrating the old basket or uploading data. See personal-data-workflows.md for acceptance walkthroughs.

Phase 6.6 now implements `/basket` on the existing Shopping v2 repository, public/local recipe additions, manual products, purchased/quantity controls, guarded clear/undo and explicit v1 migration/reconciliation. Still deferred: catalog administration/bulk importer (6.7), release deployment (6.8), accounts and remote synchronization. Production stays v0.1; migration 0002 is not applied there by this work.

Publication remains a data-layer rule: `recipeRepository.resolvePublishedRecipes` filters PUBLISHED; `resolvePublicDocuments` uses only that method. Administrative writes retain session and same-origin checks. No new public mutation endpoint exists.

Acceptance: clean and upgraded PostgreSQL 18 retain existing UUIDs/values; local browser data survives reload; failed upgrades and writes preserve old data; missing nutrition stays explicit; old basket bytes remain; all CI checks pass before review readiness. No production or infrastructure changes are part of this branch.

# Phase 6.7 delivered scope

Shared catalog administration and versioned CSV/JSON importer use existing ingredients/category/alias/nutrition tables. Required checks include stable source mappings, read-only deterministic preview, explicit ambiguity/manual-change decisions, stale-plan detection, rollback, idempotency, admin session/origin boundaries and realistic indexed search. Profile enable never supplies synthetic zeros. Bulk operations are bounded atomic parts, not destructive whole-catalog replacement. See catalog-import-schema.md for enforced limits and precedence, and catalog-owner-walkthrough.md for isolated validation.
