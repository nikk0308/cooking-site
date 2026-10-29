# Phase 6.5 personal recipes, favorites and portability

Base main: `c58b483e23193dea6500dd8094747d02e511eb42`.

## Implemented routes

- `/`: existing SSR public catalog with small hydrated favorite buttons.
- `/recipes/[slug]`: existing public detail, servings, nutrition and old basket, plus favorite.
- `/my-recipes`: local cards, create/open/edit/duplicate/delete and backup panel.
- `/my-recipes/new`, `/my-recipes/[id]/edit`: practical editor with stable ingredient/step IDs, order controls, groups, notes, exact quantity strings, units and full Blob asset preservation.
- `/my-recipes/[id]`: photos, canonical servings scaling, explicit partial nutrition and local actions.
- `/favorites`: mixed PUBLIC/LOCAL references; inaccessible recipes stay listed until explicitly removed. Temporary public resolution failure differs from confirmed unavailability.
- `/basket`: Phase 6.6 unified Shopping v2 UI. Public/local detail actions use the selected portions and upsert a namespaced reference. Old v1 writes stop; transfer is explicit and preserves the source. See shopping-and-nutrition.md for migration, reconciliation, purchased/override and undo workflows.

`GET /api/recipes/resolve?id=UUID` resolves 1–100 IDs through published-only repository methods. DRAFT/ARCHIVED are never returned. `GET /api/catalog?query=...` accepts an explicit 1–100-character search and returns at most ten catalog products with unit/provenance snapshots. The editor sends only the separate search field on button press, never personal ingredient/recipe text automatically. Both endpoints are read-only; no public catalog writes were introduced.

## Browser ownership and errors

Recipes, photos, favorites and shopping v2 live in IndexedDB in this origin/profile. There is no account or synchronization. Server backups do not contain these data. **Deleting site data or a browser profile can destroy personal recipes unless a backup has been exported.** Missing, corrupted, blocked, unsupported future versions and quota errors have explicit states. No error clears storage. Normal editing is explicit save; navigation away from dirty edits asks confirmation, including browser unload/back. Keep the tab open until save or export succeeds.

Product identity uses CATALOG or stable LOCAL UUID, never similar names. Renaming a LOCAL product preserves identity and nutrition; typing never generates product IDs. For a different food, “Заменить другим продуктом” creates one new LOCAL identity, clears its name and old nutrition, and preserves the ingredient-line UUID and all unrelated fields. Catalog names are read-only until “Сделать личным продуктом” explicitly detaches the catalog identity and nutrition once; subsequent local renaming keeps that identity. Selecting another catalog product retains the selected catalog identity/nutrition. Quantity/note/order edits preserve product identity. Missing nutrition is not zero. Scaling always starts from original canonical Decimal quantities. Photos preserve their original bytes; sensitive metadata may be present in an exported file.

## Export and restore

On `/my-recipes`, choose “Экспортировать все личные данные”. Save `culinote-backup-YYYY-MM-DD.json` somewhere outside the browser profile. The confirmation shows export date. The file includes all local recipes/photos, favorites (PUBLIC and LOCAL) and shopping v2, but excludes old basket v1 and unrelated browser storage. It is personal data: do not publish it. Bounds and transaction guarantees are documented in storage-and-privacy.md.

Choose a JSON file to import. The preview shows new/identical recipe counts, new photos, favorite references, shopping rows, date, file bytes and conflicts. No write occurs until “Подтвердить импорт”. Conflicts block confirmation; no existing record is silently overwritten. Identical repeated imports are safe. A change in another tab invalidates the preview; repeat preview before confirmation. No personal import/export data are sent to a backend. Close older application tabs before restoring.

## Owner manual walkthrough (disposable data only)

Use a separate temporary browser profile and a local PostgreSQL test database. Set `DATABASE_URL` to that isolated database, run `npm run db:migrate`, `npm run db:seed-demo`, then `npm run dev`. Open `http://localhost:3000`; never point these commands at production. The Playwright suite instead creates isolated databases and uses `http://127.0.0.1:3100` with fresh contexts.

1. Open “Мои рецепты”, create a sample with four portions, 500 g of a manual product, two steps and a small PNG. Save and reload; verify text and photo remain.
2. Select six portions: 750 g. Return to four: 500 g. Unknown nutrition must show partial coverage. Edit, select a catalog product explicitly, save without replacing the photo; check compatible nutrition.
3. Duplicate; verify independent recipe and photo IDs via normal independent editing/deletion. Delete only the disposable duplicate after confirmation.
4. Favorite a public recipe and a personal one. Open favorites, reload, remove one in another tab; the visible state updates. Keyboard Tab navigation reaches separate link/button controls.
5. Export. In a second disposable browser profile on the same local URL, import, inspect preview and confirm. Reload and verify photos, favorites and recipe content. Import the same file again: identical records skip.
6. Edit an imported recipe, then preview the old backup again: conflict blocks replacement. Change a JSON copy to invalid content: rejection must preserve current data. Do not clear a real browser profile for testing.
7. Change editor text and try a navigation link/back: cancel keeps the draft. At 390 px viewport, inspect editor/detail/cards without horizontal overflow.

## Remaining scope

Phase 6.6 now implements shopping v2, verified v1 migration/reconciliation, purchased state, manual products and quantity overrides. Phase 6.7 remains protected catalog administration and bulk importer. Phase 6.8 remains cross-browser stabilization and separately authorized release/migration/rollback. No phase starts automatically. Streaming export, import-as-copies, cross-device sync and accounts are not implemented.
