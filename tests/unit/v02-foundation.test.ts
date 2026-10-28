import { describe, it, expect } from "vitest";
import DecimalJS from "decimal.js";
import { recipeKey, parseRecipeKey } from "@/modules/recipes/reference";
import {
  localRecipeDocument,
  recipeDocument,
} from "@/modules/recipes/document";
import {
  favoritesDocument,
  resolveFavorites,
} from "@/modules/favorites/document";
import {
  resolveShopping,
  documentNutrition,
} from "@/modules/shopping/calculation";
import {
  emptyShopping,
  type ShoppingDocument,
} from "@/modules/shopping/document";
import { localRecipe, productId, recipeId } from "../helpers/v02";
import { standardUnits } from "@/modules/units/unit";
import { normalizeIngredientName } from "@/modules/catalog/normalization";
import { browserExport } from "@/platform/browser/export-contract";
import { openBrowserDatabase } from "@/platform/browser/database";
import { parseDecimal } from "@/shared/decimal/decimal";

const doc = (): ShoppingDocument => ({
  ...emptyShopping(),
  recipes: [
    {
      id: recipeId,
      reference: { kind: "LOCAL", id: recipeId },
      selectedServings: 6,
      addedAt: "2026-10-28T00:00:00Z",
    },
  ],
});
describe("v0.2 contracts and shared calculations", () => {
  it("separates public/local namespaces, canonicalizes UUIDs and rejects malformed keys", () => {
    const id = "abcdefab-abcd-4bcd-8bcd-abcdefabcdef";
    expect(recipeKey({ kind: "LOCAL", id: id.toUpperCase() })).toBe(
      `LOCAL:${id}`,
    );
    expect(parseRecipeKey(`PUBLIC:${id}`)).toEqual({ kind: "PUBLIC", id });
    expect(recipeKey({ kind: "LOCAL", id })).not.toBe(
      recipeKey({ kind: "PUBLIC", id }),
    );
    for (const value of ["PUBLIC:bad", `LOCAL:${id}:extra`, `WRONG:${id}`])
      expect(() => parseRecipeKey(value)).toThrow();
  });
  it("validates recipe ownership, child IDs, versions and local photo references", () => {
    const r = localRecipe();
    expect(localRecipeDocument.parse(r)).toEqual(r);
    expect(() =>
      localRecipeDocument.parse({
        ...r,
        reference: { kind: "PUBLIC", id: recipeId },
      }),
    ).toThrow();
    expect(() => recipeDocument.parse({ ...r, schemaVersion: 999 })).toThrow();
    expect(() =>
      recipeDocument.parse({
        ...r,
        ingredients: [r.ingredients[0], r.ingredients[0]],
      }),
    ).toThrow();
    expect(() =>
      recipeDocument.parse({
        ...r,
        photos: [
          { kind: "LOCAL", id: productId, alt: "", url: "blob:temporary" },
        ],
      }),
    ).toThrow();
  });
  it("deduplicates favorites by reference and preserves unavailable versus unresolved", async () => {
    const ref = localRecipe().reference;
    expect(() =>
      favoritesDocument.parse({ schemaVersion: 1, items: [ref, ref] }),
    ).toThrow();
    expect(
      favoritesDocument.parse({
        schemaVersion: 1,
        items: [ref, { ...ref, kind: "PUBLIC" }],
      }).items,
    ).toHaveLength(2);
    expect(
      (await resolveFavorites([ref], async () => null))[0].availability,
    ).toBe("UNAVAILABLE");
    expect(
      (
        await resolveFavorites([ref], async () => {
          throw new Error("offline");
        })
      )[0].availability,
    ).toBe("UNRESOLVED");
  });
  it("scales from canonical quantities and preserves edited/purchased state by stable identity", () => {
    const shopping = doc(),
      r = localRecipe();
    const item = resolveShopping(shopping, [r]).items[0];
    expect(item.quantity).toBe("750");
    const edited = resolveShopping(
      {
        ...shopping,
        overrides: [{ id: item.id, purchased: true, quantity: "800" }],
      },
      [r],
    ).items[0];
    expect(edited).toMatchObject({
      id: item.id,
      quantity: "800",
      calculatedQuantity: "750",
      purchased: true,
    });
    expect(
      resolveShopping(
        {
          ...shopping,
          recipes: [{ ...shopping.recipes[0], selectedServings: 4 }],
        },
        [r],
      ).items[0].quantity,
    ).toBe("500");
    expect(resolveShopping(shopping, []).unavailable).toEqual([r.reference]);
  });
  it("merges products by identity and compatible dimension, never by name", () => {
    const r = localRecipe(),
      base = r.ingredients[0];
    r.ingredients = [
      base,
      {
        ...base,
        id: crypto.randomUUID(),
        quantity: "0.5",
        unit: standardUnits.kg,
      },
      { ...base, id: crypto.randomUUID(), unit: standardUnits.ml },
      {
        ...base,
        id: crypto.randomUUID(),
        product: { kind: "LOCAL", id: productId },
      },
    ];
    const items = resolveShopping(
      { ...doc(), recipes: [{ ...doc().recipes[0], selectedServings: 4 }] },
      [r],
    ).items;
    expect(items).toHaveLength(3);
    expect(
      items.find(
        (i) => i.unit.dimension === "MASS" && i.product.kind === "CATALOG",
      ),
    ).toMatchObject({ quantity: "1000", incompatible: true });
  });
  it("never merges CUSTOM, and its identifiers survive reordering", () => {
    const r = localRecipe(),
      base = r.ingredients[0],
      custom = {
        code: "bunch",
        name: "bunch",
        symbol: "bunch",
        dimension: "CUSTOM" as const,
        factorToBase: null,
      };
    r.ingredients = [
      base,
      { ...base, id: crypto.randomUUID(), unit: custom },
      { ...base, id: crypto.randomUUID(), unit: custom },
    ];
    const first = resolveShopping(doc(), [r]).items;
    expect(first).toHaveLength(3);
    expect(first.every((i) => i.incompatible)).toBe(true);
    r.ingredients.reverse();
    expect(
      resolveShopping(doc(), [r])
        .items.map((i) => i.id)
        .sort(),
    ).toEqual(first.map((i) => i.id).sort());
  });
  it("combines manual and recipe quantities only for the same product identity", () => {
    const shopping = doc(),
      r = localRecipe();
    shopping.manual.push({
      id: crypto.randomUUID(),
      product: r.ingredients[0].product,
      name: "Same catalog product",
      quantity: "250",
      unit: standardUnits.g,
    });
    expect(resolveShopping(shopping, [r]).items[0].quantity).toBe("1000");
    shopping.manual[0].product = { kind: "LOCAL", id: productId };
    expect(resolveShopping(shopping, [r]).items).toHaveLength(2);
  });
  it("does not lose low-order decimals at the supported quantity boundary", () => {
    const r = localRecipe(),
      first = r.ingredients[0];
    r.ingredients = [
      {
        ...first,
        quantity: "999999999999999999999999.000000000000000000000001",
      },
      {
        ...first,
        id: crypto.randomUUID(),
        quantity: "0.000000000000000000000001",
      },
    ];
    const d = doc();
    d.recipes[0].selectedServings = 4;
    expect(resolveShopping(d, [r]).items[0].quantity).toBe(
      "999999999999999999999999.000000000000000000000002",
    );
    expect(DecimalJS.precision).toBe(20);
    expect(() => parseDecimal("Infinity")).toThrow();
  });
  it("exposes partial nutrition without presenting unknown totals as zero", () => {
    const r = localRecipe();
    expect(documentNutrition(r)).toMatchObject({
      total: null,
      perServing: null,
      coverage: { complete: false, knownIngredients: 0 },
    });
    r.ingredients[0].nutrition = {
      basisQuantity: "100",
      basisUnit: standardUnits.g,
      caloriesKcal: "100",
      proteinG: "10",
      fatG: "2",
      carbohydratesG: "3",
      source: { kind: "MANUAL", note: null, url: null, identifier: null },
    };
    expect(documentNutrition(r)).toMatchObject({
      total: { caloriesKcal: "500" },
      perServing: { caloriesKcal: "125" },
      coverage: { complete: true },
    });
    r.ingredients.push({
      ...r.ingredients[0],
      id: crypto.randomUUID(),
      unit: standardUnits.ml,
    });
    expect(documentNutrition(r)).toMatchObject({
      total: null,
      knownTotal: { caloriesKcal: "500" },
      coverage: { complete: false },
    });
  });
  it("normalizes names without conflating product identities", () => {
    expect(normalizeIngredientName("  ЗЕЛЁНЫЙ\t лук  ")).toBe("зеленый лук");
    expect(normalizeIngredientName("ＭＩＬＫ")).toBe("milk");
  });
  it("defines a bounded portable export and rejects dangling photos/duplicate recipes", () => {
    const value = {
      application: "culinote",
      schemaVersion: 1,
      createdAt: "2026-10-28T00:00:00Z",
      recipes: [localRecipe()],
      photos: [],
      favorites: { schemaVersion: 1, items: [] },
      shopping: emptyShopping(),
    };
    expect(browserExport.parse(value).recipes).toHaveLength(1);
    expect(() =>
      browserExport.parse({
        ...value,
        recipes: [localRecipe(), localRecipe()],
      }),
    ).toThrow();
    expect(() =>
      browserExport.parse({
        ...value,
        recipes: [
          {
            ...localRecipe(),
            photos: [{ kind: "LOCAL", id: productId, alt: "" }],
          },
        ],
      }),
    ).toThrow();
  });
  it("reports unavailable browser storage explicitly in non-browser runtimes", async () => {
    await expect(
      openBrowserDatabase("no-browser", undefined),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
