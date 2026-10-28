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

Still deferred: unified shopping UI and explicit basket migration activation (6.6), catalog administration/bulk importer (6.7), release deployment (6.8), accounts and remote synchronization. Production stays v0.1; migration 0002 is not applied there by this work.

Publication remains a data-layer rule: `recipeRepository.resolvePublishedRecipes` filters PUBLISHED; `resolvePublicDocuments` uses only that method. Administrative writes retain session and same-origin checks. No new public mutation endpoint exists.

Acceptance: clean and upgraded PostgreSQL 18 retain existing UUIDs/values; local browser data survives reload; failed upgrades and writes preserve old data; missing nutrition stays explicit; old basket bytes remain; all CI checks pass before review readiness. No production or infrastructure changes are part of this branch.
