import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseDecimal, serializeDecimal } from "@/shared/decimal/decimal";
describe("decimal boundary", () => {
  it("parses and serializes PostgreSQL NUMERIC strings exactly", () => {
    expect(
      serializeDecimal(parseDecimal("12345678901234567890.123456789")),
    ).toBe("12345678901234567890.123456789");
  });
  it("does not inherit binary floating-point arithmetic", () => {
    expect(
      serializeDecimal(parseDecimal("0.1").plus(parseDecimal("0.2"))),
    ).toBe("0.3");
    expect(new Decimal(0.1 + 0.2).toString()).not.toBe("0.3");
  });
  it("rejects a non-string boundary at runtime", () => {
    expect(() => parseDecimal(0.1 as unknown as string)).toThrow(TypeError);
  });
});
