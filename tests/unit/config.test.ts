import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "@/platform/config/runtime";
describe("runtime configuration", () => {
  it("accepts a bounded valid configuration", () => {
    expect(
      parseRuntimeConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/recipes",
      }).DATABASE_QUERY_TIMEOUT_MS,
    ).toBe(2000);
  });
  it("rejects missing or non-PostgreSQL URLs", () => {
    expect(() => parseRuntimeConfig({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      parseRuntimeConfig({ DATABASE_URL: "https://example.test" }),
    ).toThrow();
  });
});
