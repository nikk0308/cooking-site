# Domain model

`RecipeReference = {kind: PUBLIC | LOCAL, id: UUID}`. Canonical string: `PUBLIC:<lowercase UUID>` or `LOCAL:<lowercase UUID>`. Same UUID in different origins is a different recipe. References have strict validation; no title/slug matching establishes identity.

`RecipeDocument` version 1 is the common calculation/view contract: reference, title, description, slug, baseServings, ordered ingredient lines, grouped ingredients, ordered steps and photo references. Public slugs come from PostgreSQL; local slugs are null and local routes must use UUIDs. Local drafts may be incomplete. PUBLIC documents are projected from published server aggregates, not persisted as personal recipes.

Ingredient lines have their own UUID, `{kind: CATALOG | LOCAL, id: UUID}` product reference, display name, canonical string quantity, unit snapshot, optional group/note and nullable nutrition snapshot. CATALOG maps directly to existing `ingredients.id`. LOCAL product IDs are browser identities; matching names never merges products. Duplication retains product identities and recipe content but creates a new recipe UUID and new owned photo UUIDs.

Local photos reference owned Blob records by UUID. Public photos reference `/media/<key>.webp`. Their origins must match the recipe; temporary Object URLs are not domain data. Steps/lines/photo references have unique IDs within a recipe. No local record is accepted at the server recipe/admin schema implicitly.

Favorites version 1 stores unique recipe references. Removing a local recipe retains dangling favorites/shopping references so the caller can expose unavailable items rather than silently discard intent. `resolveFavorites` distinguishes AVAILABLE, UNAVAILABLE and UNRESOLVED (e.g. an offline public resolver). There is no server favorites table.

New storage schemas and pure calculations are independent from the existing v0.1 basket and admin/public screens. Subsequent phases must use these contracts rather than introduce another identity or arithmetic implementation.
