# Unified shopping v2 and nutrition

ShoppingDocument schemaVersion 2 is authoritative on `/basket` in Phase 6.6. It has a stable list UUID, selected recipes (row UUID, recipe reference, selectedServings, addedAt), manual products (row/product IDs, name, canonical quantity/unit) and overrides (derived row ID, purchased, nullable edited quantity). There is no shopping server table or new canonical localStorage document. PUBLIC and LOCAL recipe detail actions upsert selected portions transactionally: adding an existing reference updates portions without changing row ID. Equal UUIDs across PUBLIC/LOCAL remain distinct.

`resolveShopping` receives validated available recipe documents. It scales from original base quantities with `scaleQuantityForServings`, then calls existing `aggregateBasket` and unit conversion. Products merge only by namespaced identity and compatible dimension. MASS/VOLUME/COUNT are separate. CUSTOM rows retain source-line/manual-row identity and never automatically merge. Derived IDs survive source reordering; overrides do not mutate canonical recipe amounts. Quantities are serialized strings; calculatedQuantity is retained separately from an edited quantity. Unavailable recipe references remain explicit, with no invented lines.

The shared Decimal constructor has private 256-significant-digit precision, preserving supported bounded decimal operations without changing global decimal.js configuration. Nonterminating division remains deterministic Decimal approximation; display rounding is never stored back as a recipe base. No JavaScript float arithmetic is used for domain quantities. Unit dimensions cannot cross without an explicit future ingredient-specific contract; no implicit density is supplied.

`documentNutrition` reuses `calculateRecipeNutrition`, associating profiles with stable ingredient-line IDs. Missing or incompatible profiles produce incomplete coverage and explicit reasons. Full total/perServing are null when coverage is incomplete; knownTotal/knownPerServing are labeled partial sums. An absent profile is never synthesized as zero. Existing v0.1 nutrition behavior and its coverage guard remain compatible.

## Legacy migration

`repo.migrateBasket(localStorage)` explicitly migrates `recipes:basket:v1`. The Phase 6.6 UI no longer writes v1. `/basket` checks v1 without migrating automatically. Nonempty, corrupt or unsupported legacy data suppress a misleading empty-list message and show an actionable migration/recovery notice. Preview and explicit confirmation precede transfer. Existing PUBLIC v2 portions win on the initial transfer; the preview explains this. LOCAL rows and manual/override data stay unchanged.

1. Validate bounded source JSON. Preserve its exact bytes.
2. Atomically merge missing PUBLIC references into shopping v2, retaining existing local/manual items and selected values. Resolve UUID row collisions without confusing PUBLIC and LOCAL identities.
3. Write an unverified receipt and target together. Abort rolls both back on failure.
4. In a subsequent transaction, read back and validate the exact target/receipt, then mark verified. A crash or quota error between stages resumes verification without duplicates.

Results: NO_SOURCE, MIGRATED, ALREADY_MIGRATED or LEGACY_CHANGED. Source v1 is never written/deleted by this adapter, even after verification. The first transaction checks the preview revision and exact source bytes before applying; the second verifies the saved target/receipt. A pending receipt survives reload and is explicitly resumable. Reconciliation can rebase a failed verification onto the reviewed current v2 state without discarding later edits.

## LEGACY_CHANGED reconciliation

Storage events from old tabs and focus/manual refresh detect changed v1 bytes. The UI lists v1 versus current v2 portions, added entries and v1 removals. New references can be added; changed portions that conflict with a current selection or an intentional v2 removal require an explicit v1/v2 choice. Unchanged legacy entries do not resurrect v2 removals. Deletion in v1 never deletes a v2 row automatically. Current manual products, overrides and purchased marks are preserved. A new revision/source check rejects stale confirmation. The receipt stores the first original raw bytes as well as the latest acknowledged source.

localStorage and IndexedDB cannot form a single cross-storage transaction: a legacy writer may change v1 during/after commit. The captured source is preserved, final verification returns LEGACY_CHANGED and the new source requires another explicit preview; no automatic reconciliation loop runs. A missing v1 source is reported without deleting v2 or the saved original. Malformed/future versions, denied storage and quota/abort failures never clear either version.

## Manual products, purchased marks and overrides

Manual rows have stable row/product UUIDs. Free text creates a distinct LOCAL product; identical names do not merge. Explicit catalog search reuses the bounded read-only endpoint. LOCAL renaming preserves identity. Catalog detachment and replacing a different food are explicit actions; row UUID, quantity and unit remain stable unless the user edits them.

Aggregation reuses `resolveShopping` / `aggregateBasket` / Decimal conversion and scaling. Public resolution uses published-only GET reads; local documents stay in IndexedDB. Temporarily unresolved and confirmed unavailable recipes remain selected and removable. Known subtotals are visibly incomplete; aggregate editing is disabled until those sources are resolved or removed.

Purchased and quantity edits use stable derived IDs and transactional field-level updates. Editing the calculated quantity writes only the override; resetting removes that quantity override while retaining a purchased mark. Even an override equal to the calculated amount can be reset. Servings changes recalculate canonical totals while preserving explicit edits. Hide-purchased is a view filter, not deletion.

Explicit source deletion/edit prunes overrides whose buckets disappear; a shared remaining product keeps its state. Removing the last contribution retires its override before later re-addition. With unresolved sources, deletion/edit warns that dormant settings cannot be attributed reliably, prunes unknown buckets and saves a checkpoint before applying. Reordering never changes IDs. CUSTOM derived IDs additionally include source and custom unit code/symbol so changing an incompatible custom unit cannot inherit the prior edit. Pre-UI foundation backups with older CUSTOM override keys keep those unmatched records; they are not applied to a different unit and are retired on explicit source pruning.

## Clear, checkpoint and tabs

Clear-purchased and clear-all require confirmation. Clear-all removes only shopping recipes/manual/overrides, retaining the list UUID. Source removal/edit and clear-all atomically store one `shopping:undo` checkpoint alongside the new document. Undo survives reload and uses compare-and-swap against the exact post-action shopping document. If the list changed meanwhile, undo is disabled/rejected rather than overwriting newer data; the checkpoint remains until the next checkpoint action. Undo never changes personal recipes, photos, favorites or v1. Export current data before clearing if an independent portable checkpoint is needed.

All writes go through the existing repository. Concurrent additions, portions and purchased/quantity fields use transaction callbacks against the latest document. Structural pruning/manual editing and clear use revision guards, so a stale view must refresh instead of replacing newer state. BroadcastChannel sends change signals only; focus refresh is a fallback. Imports use the existing notifications and revision guard.

If an already-open IndexedDB becomes unavailable, the last loaded view and manual draft stay visible with an explicit stale-state warning and disabled mutations. Refresh retries reads; a successful retry re-enables the retained draft. Save text edits separately before reloading a permanently closed/unavailable database. Multi-digit portions use a pending UI value while transactional writes serialize; quantity-editor drafts are not reset by recalculation in another tab.

## Backup compatibility and owner check

The existing browser JSON backup includes the entire ShoppingDocument v2: references, portions, manual rows, purchased flags and quantity overrides. Import keeps the Phase 6.5 validation/preview/confirmation/atomic conflict policy. No second export format is introduced. Legacy v1 and internal migration receipts/undo checkpoints are excluded; migrate v1 and undo a clear before exporting if those data should be in the portable list.

Use a disposable browser profile and an isolated local PostgreSQL database. After `npm run db:migrate`, `npm run db:seed-demo`, `npm run dev`, open `http://localhost:3000`:

1. Add a public recipe with six portions; add it again with four. Verify one selected row at `/basket`. Add a personal recipe from its detail page too.
2. Change portions, mark a product purchased, set a quantity override, reload and reset it. Check canonical totals return to the original when portions return.
3. Add two same-named free-text products; verify they remain separate. Select a catalog product explicitly to test compatible aggregation.
4. Open another tab, change portions and add a manual product/mark purchased concurrently. Both tabs must retain all changes.
5. Clear after confirmation, reload, then undo. Make a new edit after another clear: undo must not overwrite it.
6. Export from “Мои рецепты”, import in another disposable profile, verify portions/manual/purchased/override state.
7. In the disposable profile only, supply a valid old `recipes:basket:v1` fixture. Review and confirm transfer. Change its portions in a second old tab: the new UI must require explicit reconciliation, retaining original v1 bytes. Never clear real browser data for testing.

No production migration, infrastructure change, bulk catalog importer or Phase 6.7 work is included.
