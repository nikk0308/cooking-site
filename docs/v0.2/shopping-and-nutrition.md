# Shopping and nutrition foundation

ShoppingDocument schemaVersion 2 has a stable list UUID, selected recipes (row UUID, recipe reference, selectedServings, addedAt), manual products (row/product IDs, name, canonical quantity/unit) and overrides (derived row ID, purchased, nullable edited quantity). The repository supports validated atomic updates; Phase 6.6 owns user controls.

`resolveShopping` receives validated available recipe documents. It scales from original base quantities with `scaleQuantityForServings`, then calls existing `aggregateBasket` and unit conversion. Products merge only by namespaced identity and compatible dimension. MASS/VOLUME/COUNT are separate. CUSTOM rows retain source-line/manual-row identity and never automatically merge. Derived IDs survive source reordering; overrides do not mutate canonical recipe amounts. Quantities are serialized strings; calculatedQuantity is retained separately from an edited quantity. Unavailable recipe references remain explicit, with no invented lines.

The shared Decimal constructor has private 256-significant-digit precision, preserving supported bounded decimal operations without changing global decimal.js configuration. Nonterminating division remains deterministic Decimal approximation; display rounding is never stored back as a recipe base. No JavaScript float arithmetic is used for domain quantities. Unit dimensions cannot cross without an explicit future ingredient-specific contract; no implicit density is supplied.

`documentNutrition` reuses `calculateRecipeNutrition`, associating profiles with stable ingredient-line IDs. Missing or incompatible profiles produce incomplete coverage and explicit reasons. Full total/perServing are null when coverage is incomplete; knownTotal/knownPerServing are labeled partial sums. An absent profile is never synthesized as zero. Existing v0.1 nutrition behavior and its coverage guard remain compatible.

## Legacy migration

`repo.migrateBasket(localStorage)` explicitly migrates `recipes:basket:v1`. The v0.1 UI remains on that key until Phase 6.6 integration.

1. Validate bounded source JSON. Preserve its exact bytes.
2. Atomically merge missing PUBLIC references into shopping v2, retaining existing local/manual items and selected values. Resolve UUID row collisions without confusing PUBLIC and LOCAL identities.
3. Write an unverified receipt and target together. Abort rolls both back on failure.
4. In a subsequent transaction, read back and validate the exact target/receipt, then mark verified. A crash or quota error between stages resumes verification without duplicates.

Results: NO_SOURCE, MIGRATED, ALREADY_MIGRATED or LEGACY_CHANGED. Source v1 is never deleted by this adapter, even after verification. If v0.1 changes after migration, retain both versions and return LEGACY_CHANGED; the later UI must request reconciliation rather than silently overwrite v2. Corruption and verification mismatch preserve data and report errors.
