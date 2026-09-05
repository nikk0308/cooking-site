import { describe, expect, it } from "vitest";
import { getLiveness } from "@/platform/health/live";
describe("liveness", () => {
  it("is independent of database configuration", () => {
    expect(getLiveness()).toEqual({ status: "ok" });
  });
});
