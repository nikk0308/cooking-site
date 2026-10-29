import { it, expect } from "vitest";
import {
  emptyShopping,
  type ShoppingDocument,
} from "@/modules/shopping/document";
import {
  upsertRecipe,
  editBucket,
  pruneOverrides,
} from "@/modules/shopping/operations";
import { legacyPlan, type LegacyPreview } from "@/modules/shopping/legacy";
import { resolveShopping } from "@/modules/shopping/calculation";
import { standardUnits } from "@/modules/units/unit";
import { localRecipe, recipeId } from "../helpers/v02";
const base = (): ShoppingDocument => emptyShopping();
const raw = (servings = 6) =>
  JSON.stringify({
    schemaVersion: 1,
    items: [
      {
        recipeId,
        selectedServings: servings,
        schemaVersion: 1,
        addedAt: "2026-10-28T00:00:00Z",
      },
    ],
  });
const preview = (): LegacyPreview => ({
  raw: raw(),
  receipt: null,
  shopping: base(),
  revision: 0,
});
it("upserts servings while preserving row identity, namespaces and unrelated data", () => {
  const ref = localRecipe().reference;
  let d = upsertRecipe(base(), ref, 4);
  const id = d.recipes[0].id;
  d = editBucket(d, "unrelated", { purchased: true });
  d = upsertRecipe(d, ref, 6);
  expect(d.recipes[0]).toMatchObject({ id, selectedServings: 6 });
  expect(d.overrides).toHaveLength(1);
  d = upsertRecipe(d, { ...ref, kind: "PUBLIC" }, 3);
  expect(d.recipes).toHaveLength(2);
  expect(d.recipes[1].id).not.toBe(id);
});
it("rejects invalid servings and respects the 100-reference bound", () => {
  expect(() => upsertRecipe(base(), localRecipe().reference, 0)).toThrow();
  let d = base();
  for (let i = 0; i < 100; i++)
    d = upsertRecipe(d, { kind: "PUBLIC", id: crypto.randomUUID() }, 1);
  expect(() => upsertRecipe(d, localRecipe().reference, 1)).toThrow();
});
it("allows resetting an equal calculated override and bounds persisted bucket settings", () => {
  const r = localRecipe(),
    d = upsertRecipe(base(), r.reference, 4),
    item = resolveShopping(d, [r]).items[0];
  const edited = editBucket(d, item.id, { quantity: "500" });
  expect(resolveShopping(edited, [r]).items[0]).toMatchObject({
    overridden: true,
    quantity: "500",
    calculatedQuantity: "500",
  });
  expect(
    resolveShopping(editBucket(edited, item.id, { quantity: null }), [r])
      .items[0].overridden,
  ).toBe(false);
  const full = {
    ...base(),
    overrides: Array.from({ length: 1000 }, (_, i) => ({
      id: `row-${i}`,
      purchased: true,
      quantity: null,
    })),
  };
  expect(() => editBucket(full, "another", { purchased: true })).toThrow();
  expect(
    editBucket(full, "another", { quantity: null }).overrides,
  ).toHaveLength(1000);
  expect(
    editBucket(full, "row-0", { purchased: false }).overrides,
  ).toHaveLength(999);
});
it("rejects unsupported reconciliation choices and retains source timestamps for new rows", () => {
  const p = preview();
  expect(() => legacyPlan(p, { [recipeId]: "UNKNOWN" } as never)).toThrow();
  expect(legacyPlan(p).next.recipes[0].addedAt).toBe("2026-10-28T00:00:00Z");
});
it("keeps overrides independent: resetting quantity preserves purchased state", () => {
  let d = editBucket(base(), "item", { purchased: true, quantity: "800" });
  d = editBucket(d, "item", { quantity: null });
  expect(d.overrides).toEqual([
    { id: "item", quantity: null, purchased: true },
  ]);
  expect(editBucket(d, "item", { purchased: false }).overrides).toEqual([]);
  expect(() => editBucket(d, "item", { quantity: "0" })).toThrow();
});
it("aggregates exact canonical products, keeps incompatible dimensions and same names separate", () => {
  const r = localRecipe(),
    line = r.ingredients[0];
  const d = upsertRecipe(base(), r.reference, 4);
  d.manual = [
    {
      id: crypto.randomUUID(),
      product: line.product,
      name: "Alias",
      quantity: "0.25",
      unit: standardUnits.kg,
    },
    {
      id: crypto.randomUUID(),
      product: line.product,
      name: "Alias",
      quantity: "1.123456789012345678901234",
      unit: standardUnits.ml,
    },
    ...[1, 2].map(() => ({
      id: crypto.randomUUID(),
      product: { kind: "LOCAL" as const, id: crypto.randomUUID() },
      name: line.name,
      quantity: "1",
      unit: standardUnits.g,
    })),
  ];
  const items = resolveShopping(d, [r]).items;
  expect(items).toHaveLength(4);
  expect(
    items.find(
      (i) => i.product.kind === "CATALOG" && i.unit.dimension === "MASS",
    )?.quantity,
  ).toBe("750");
  expect(items.find((i) => i.unit.dimension === "VOLUME")?.quantity).toBe(
    "1.123456789012345678901234",
  );
  expect(
    resolveShopping(
      { ...d, recipes: [{ ...d.recipes[0], selectedServings: 6 }] },
      [r],
    ).items[0].quantity,
  ).toBe("1000");
  expect(resolveShopping(d, [r]).items[0].quantity).toBe("750");
});
it("retires disappeared overrides without affecting a remaining shared product", () => {
  const r = localRecipe(),
    d = upsertRecipe(base(), r.reference, 4),
    line = r.ingredients[0];
  d.manual = [
    {
      id: crypto.randomUUID(),
      product: line.product,
      name: line.name,
      quantity: "5",
      unit: line.unit,
    },
  ];
  const item = resolveShopping(d, [r]).items[0];
  d.overrides = [{ id: item.id, quantity: "800", purchased: true }];
  const remaining = pruneOverrides(d, { ...d, recipes: [] }, [r]);
  expect(remaining.overrides).toEqual(d.overrides);
  expect(
    pruneOverrides(remaining, { ...remaining, manual: [] }, []).overrides,
  ).toEqual([]);
  expect(
    resolveShopping({ ...d, recipes: [...d.recipes].reverse() }, [r]).items[0]
      .id,
  ).toBe(item.id);
});
it("CUSTOM keys bind to source and unit, never aggregate or inherit another custom unit's override", () => {
  const r = localRecipe(),
    d = upsertRecipe(base(), r.reference, 4),
    custom = {
      code: "pinch",
      symbol: "щеп.",
      name: "щепотка",
      dimension: "CUSTOM" as const,
      factorToBase: null,
    };
  r.ingredients = [
    r.ingredients[0],
    { ...r.ingredients[0], id: crypto.randomUUID(), unit: custom },
  ];
  d.manual = [
    {
      id: crypto.randomUUID(),
      product: r.ingredients[0].product,
      name: "Same",
      quantity: "2",
      unit: custom,
    },
  ];
  const items = resolveShopping(d, [r]).items;
  expect(items).toHaveLength(3);
  expect(new Set(items.map((i) => i.id)).size).toBe(3);
  const old = items.find((i) => i.unit.dimension === "CUSTOM")!;
  d.overrides = [{ id: old.id, purchased: true, quantity: "9" }];
  r.ingredients[1].unit = { ...custom, code: "bunch", symbol: "пуч." };
  expect(
    resolveShopping(d, [r]).items.find((i) => i.unit.code === "bunch"),
  ).toMatchObject({ quantity: "500", purchased: false });
});
it("initial legacy migration preserves existing v2 servings and LOCAL UUID collision", () => {
  const p = preview();
  p.shopping = upsertRecipe(
    upsertRecipe(base(), { kind: "PUBLIC", id: recipeId }, 2),
    { kind: "LOCAL", id: recipeId },
    3,
  );
  const plan = legacyPlan(p);
  expect(plan.next.recipes).toHaveLength(2);
  expect(plan.rows[0].conflict).toBe(true);
  expect(plan.next.recipes[0].selectedServings).toBe(2);
  expect(plan.conflicts).toEqual([]);
});
it("reconciliation requires an explicit serving choice and preserves manual/override state", () => {
  const p = preview();
  p.shopping = upsertRecipe(base(), { kind: "PUBLIC", id: recipeId }, 8);
  p.shopping.overrides = [
    { id: "preserved", quantity: "123", purchased: true },
  ];
  p.receipt = {
    schemaVersion: 1,
    raw: raw(4),
    expected: JSON.stringify(p.shopping),
    verified: true,
  };
  expect(legacyPlan(p).conflicts).toHaveLength(1);
  expect(legacyPlan(p, { [recipeId]: "V2" }).next).toEqual(p.shopping);
  const next = legacyPlan(p, { [recipeId]: "V1" }).next;
  expect(next.recipes[0]).toEqual({
    ...p.shopping.recipes[0],
    selectedServings: 6,
  });
  expect(next.overrides).toEqual(p.shopping.overrides);
});
it("unchanged old rows do not resurrect explicit v2 removals; changed removals need a choice", () => {
  const p = preview();
  p.receipt = {
    schemaVersion: 1,
    raw: raw(),
    expected: JSON.stringify(base()),
    verified: true,
  };
  expect(legacyPlan(p).next.recipes).toEqual([]);
  p.raw = raw(8);
  expect(legacyPlan(p).conflicts).toHaveLength(1);
  expect(legacyPlan(p, { [recipeId]: "V2" }).next.recipes).toEqual([]);
  expect(
    legacyPlan(p, { [recipeId]: "V1" }).next.recipes[0].selectedServings,
  ).toBe(8);
});
it("v1 deletions never automatically delete v2 sources", () => {
  const p = preview();
  p.receipt = { schemaVersion: 1, raw: raw(), expected: "{}", verified: true };
  p.shopping = upsertRecipe(base(), { kind: "PUBLIC", id: recipeId }, 6);
  p.raw = '{"schemaVersion":1,"items":[]}';
  expect(legacyPlan(p).removed).toHaveLength(1);
  expect(legacyPlan(p).next).toEqual(p.shopping);
});
it.each([
  "bad json",
  '{"schemaVersion":99,"items":[]}',
  "x".repeat(128 * 1024 + 1),
])(
  "rejects corrupted, future or oversized legacy input without mutating v2",
  (raw) => {
    const p = preview(),
      before = structuredClone(p.shopping);
    p.raw = raw;
    expect(() => legacyPlan(p)).toThrow();
    expect(p.shopping).toEqual(before);
  },
);
