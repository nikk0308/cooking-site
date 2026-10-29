import { describe, it, expect } from "vitest";
import {
  catalogIngredientInput,
  importRecord,
  importDecisions,
} from "@/modules/catalog/input";
import {
  csvColumns,
  decodeImport,
  parseCsv,
  reportCsv,
} from "@/modules/catalog/import-format";
import { hash, sourceUuid } from "@/modules/catalog/state";
const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const record = {
  externalId: "test-1",
  name: "Синтетический продукт",
  category: null,
  aliases: [],
  nutrition: null,
};
const envelope = {
  application: "culinote-catalog",
  schemaVersion: 1,
  namespace: "synthetic-test",
  records: [record],
};
describe("catalog import contract", () => {
  it("preserves opaque special source ID decisions without prototype mutation", () => {
    const raw = JSON.parse(
      '{"__proto__":"DISTINCT","constructor":"KEEP","toString":"REPLACE"}',
    );
    const parsed = importDecisions.parse(raw);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed["__proto__"]).toBe("DISTINCT");
    expect(parsed.constructor).toBe("KEEP");
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(importDecisions.parse({}), "__proto__")).toBe(false);
    expect(() => importDecisions.parse({ x: "UNKNOWN" })).toThrow();
  });
  it("rejects escaped NUL metadata before database application", () => {
    expect(() =>
      decodeImport(encode({ ...envelope, batch: "bad\0batch" }), "json"),
    ).toThrow();
    expect(
      importRecord.safeParse({
        ...record,
        nutrition: {
          basisQuantity: "1",
          basisUnit: "g",
          caloriesKcal: "0",
          proteinG: "0",
          fatG: "0",
          carbohydratesG: "0",
          sourceKind: "UNKNOWN",
          sourceNote: "",
          sourceUrl: "https://example.invalid/\0",
          sourceIdentifier: null,
        },
      }).success,
    ).toBe(false);
  });
  it("rejects source IDs that would need implicit trimming", () => {
    expect(
      importRecord.safeParse({ ...record, externalId: " test-1 " }).success,
    ).toBe(false);
  });
  it("parses complete versioned JSON without invented nutrition", () => {
    const r = decodeImport(encode(envelope), "json");
    expect(r.records[0].result.success).toBe(true);
    if (r.records[0].result.success)
      expect(r.records[0].result.data.nutrition).toBeNull();
  });
  it.each([2, 0, "1"])("rejects unsupported schema %s", (version) =>
    expect(() =>
      decodeImport(encode({ ...envelope, schemaVersion: version }), "json"),
    ).toThrow(),
  );
  it("rejects malformed UTF8 and oversized input", () => {
    expect(() => decodeImport(new Uint8Array([255]), "json")).toThrow();
    expect(() =>
      decodeImport(new Uint8Array(1024 * 1024 + 1), "json"),
    ).toThrow();
  });
  it("parses quotes, delimiters, embedded newlines and CRLF", () =>
    expect(parseCsv('a,"b,c","a""b"\r\nx,"y\nz",q')).toEqual([
      ["a", "b,c", 'a"b'],
      ["x", "y\nz", "q"],
    ]));
  it.each(['a,"unterminated', 'a,"b"c', "a,b\rc", 'a,b"c'])(
    "rejects malformed CSV %s",
    (text) => expect(() => parseCsv(text)).toThrow(),
  );
  it("accepts BOM UTF8 CSV and exact column order", () => {
    const values = [
      "1",
      "synthetic-test",
      "test-1",
      "Тест",
      "test",
      "",
      "",
      "[]",
      ...Array(10).fill(""),
    ];
    const csv =
      "\ufeff" + csvColumns.join(",") + "\r\n" + values.join(",") + "\r\n";
    expect(
      decodeImport(new TextEncoder().encode(csv), "csv").records[0].result
        .success,
    ).toBe(true);
    expect(() =>
      decodeImport(new TextEncoder().encode("name,id\na,b"), "csv"),
    ).toThrow();
  });
  it("rejects decimal commas, exponent, excessive precision and negatives", () => {
    for (const caloriesKcal of ["1,5", "1e2", "1.1234567", "-1", ""])
      expect(
        catalogIngredientInput.safeParse({
          name: "Test",
          slug: "test",
          nutrition: {
            basisQuantity: "100",
            basisUnitId: "10000000-0000-4000-8000-000000000001",
            caloriesKcal,
            proteinG: "0",
            fatG: "0",
            carbohydratesG: "0",
          },
        }).success,
      ).toBe(false);
  });
  it("allows intentional zero and requires all nutrient values", () => {
    const n = {
      basisQuantity: "1",
      basisUnit: "g",
      caloriesKcal: "0",
      proteinG: "0",
      fatG: "0",
      carbohydratesG: "0",
      sourceKind: "UNKNOWN",
      sourceNote: "",
      sourceUrl: null,
      sourceIdentifier: null,
    };
    expect(importRecord.safeParse({ ...record, nutrition: n }).success).toBe(
      true,
    );
    expect(
      importRecord.safeParse({
        ...record,
        nutrition: { ...n, proteinG: undefined },
      }).success,
    ).toBe(false);
    expect(
      importRecord.safeParse({
        ...record,
        nutrition: { ...n, basisQuantity: "0" },
      }).success,
    ).toBe(false);
  });
  it("requires IMPORT provenance and rejects credential URLs", () => {
    const n = {
      basisQuantity: "100",
      basisUnit: "g",
      caloriesKcal: "1",
      proteinG: "0",
      fatG: "0",
      carbohydratesG: "0",
      sourceKind: "IMPORT",
      sourceNote: "synthetic",
      sourceUrl: null,
      sourceIdentifier: null,
    };
    expect(importRecord.safeParse({ ...record, nutrition: n }).success).toBe(
      false,
    );
    expect(
      importRecord.safeParse({
        ...record,
        nutrition: { ...n, sourceIdentifier: "fixture-1" },
      }).success,
    ).toBe(true);
    expect(
      importRecord.safeParse({
        ...record,
        nutrition: {
          ...n,
          sourceIdentifier: "fixture-1",
          sourceUrl: "https://user:secret@example.invalid/",
        },
      }).success,
    ).toBe(false);
  });
  it("rejects normalized alias duplicates for manual CRUD", () =>
    expect(
      catalogIngredientInput.safeParse({
        name: "Test",
        slug: "test",
        aliases: ["Ёж", "еж"],
      }).success,
    ).toBe(false));
  it("binds identity to source IDs and fingerprint to exact values", () => {
    expect(sourceUuid("a", "1")).toBe(sourceUuid("a", "1"));
    expect(sourceUuid("a", "1")).not.toBe(sourceUuid("b", "1"));
    expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
    expect(hash("0.1")).not.toBe(hash("0.2"));
  });
  it("neutralizes spreadsheet formulas in reports", () => {
    const csv = reportCsv([
      { row: 2, externalId: "=1+1", status: "INVALID", messages: ["@command"] },
    ]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@command");
  });
});
