# ADR 0002: Recipe domain model

Status: accepted for Phase 4 review.

## Model

```text
Recipe
 ├─< RecipeIngredient >─ Ingredient
 │          │             └── IngredientNutrition
 │          └───────────────> Unit
 │                            ↑
 └─< RecipeStep               └── nutrition basis Unit
```

`RecipeIngredient` and `RecipeStep` are recipe-owned and cascade when their recipe is deleted. Ingredients and units are shared canonical records, so references from recipe lines restrict deletion. An ingredient owns its optional one-to-one nutrition profile; deleting the ingredient cascades that profile. Slugs and unit codes are unique database identities. A repeated ingredient is allowed at different recipe positions. Optional `group_label` supports simple headings such as «Для теста» without introducing a premature group entity.

Ingredient identity is culinary rather than merely display text. When preparation state materially changes nutrition, raw and cooked forms may be separate canonical ingredients. A richer state taxonomy is deferred.

## Exact numbers and units

Recipe quantities, nutrition bases, and nutrients use PostgreSQL `NUMERIC(18,6)`: up to 12 integer and 6 fractional digits. Unit conversion metadata uses `NUMERIC(24,12)` so future valid coefficients are not limited to six fractional digits. `pg` returns NUMERIC as strings; domain arithmetic parses those strings into `Decimal` and never uses JavaScript binary floating point. Calculations keep Decimal precision and presentation formatting is separate.

Dimensions are `MASS`, `VOLUME`, `COUNT`, and `CUSTOM`. Their bases are `g`, `ml`, and `pcs`; standard factors are `kg=1000g`, `l=1000ml`, `tsp=5ml`, and `tbsp=15ml`. Conversion is allowed only inside one non-CUSTOM dimension. MASS↔VOLUME, COUNT↔other dimensions, and CUSTOM conversion are rejected. Ingredient-specific density conversion is deferred.

Standard units are reference data inside the first versioned migration, with deterministic UUIDs and `ON CONFLICT(code) DO NOTHING`. This keeps fresh databases reproducible and avoids a destructive or manually coordinated production seed. Integration tests compare all seven migrated rows and fixed IDs with the TypeScript definitions. CI validates migration history and regenerates in a disposable context to reject schema changes without matching migration metadata.

## Scaling, nutrition, and basket

Recipe quantities are canonical only at `base_servings`, a positive integer. Scaling always starts from that base and computes `base quantity × target servings ÷ base servings`; scaled values are transient and may be fractional even for COUNT. There is no cumulative or presentation rounding in canonical calculations.

Nutrition belongs to a canonical ingredient and has a positive quantity/unit basis. Contribution is calculated only when a recipe quantity converts safely to that basis dimension. Missing profiles and incompatible dimensions remain explicit missing contributions; known contributions may still produce a partial total, but coverage is marked incomplete. Total nutrition scales linearly with servings while per-serving nutrition remains invariant.

Basket primitives group strictly by ingredient ID and compatible dimension, normalize convertible values to the dimension base, and keep incompatible dimensions in separate buckets with an explicit incompatibility list. Basket persistence and `localStorage` integration are deferred.

## Publication and deferred work

States are `DRAFT`, `PUBLISHED`, and `ARCHIVED`; only `PUBLISHED` is public-eligible, and the database requires `published_at` for that state. Public repositories must use the explicit public predicate rather than generic status-blind reads.

Slug generation is deterministic lowercase Russian-to-Latin transliteration with hyphen normalization; database uniqueness is authoritative. Slug history and redirects are deferred, as are recipe variants, density conversions, full basket persistence, public UI, admin/auth, search/categories, and cached public-route validation.
