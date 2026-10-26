import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import {
  hashPassword,
  verifyPassword,
  hashSessionToken,
  newSessionToken,
  sessionActive,
} from "@/modules/admin/crypto";
import { sameOrigin, allowLogin } from "@/modules/admin/protection";
import { recipeInput, ingredientInput } from "@/modules/recipes/input";
import { parseBasket, basketDocument } from "@/modules/basket/document";
import { displayQuantity } from "@/modules/recipes/presentation";
import { standardUnits } from "@/modules/units/unit";
import { mediaPath, checkMediaStorage } from "@/modules/media/storage";
describe("v0.1 boundaries", () => {
  it("uses salted scrypt and rejects incorrect passwords", async () => {
    const password = newSessionToken();
    const hash = await hashPassword(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("incorrect", hash)).toBe(false);
    expect(await hashPassword(password)).not.toBe(hash);
    expect(await verifyPassword(password, "invalid")).toBe(false);
  });
  it("stores deterministic session hashes, not tokens", () => {
    const token = newSessionToken();
    expect(token).toHaveLength(64);
    expect(hashSessionToken(token)).toHaveLength(64);
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
  it("enforces absolute expiry, idle timeout and revocation", () => {
    const now = new Date(100000000);
    const session = {
      expiresAt: new Date(+now + 1000),
      lastSeenAt: now,
      revokedAt: null,
    };
    expect(sessionActive(session, now)).toBe(true);
    expect(sessionActive({ ...session, expiresAt: now }, now)).toBe(false);
    expect(
      sessionActive({ ...session, lastSeenAt: new Date(+now - 3600000) }, now),
    ).toBe(false);
    expect(sessionActive({ ...session, revokedAt: now }, now)).toBe(false);
  });
  it("rejects foreign and missing origins", () => {
    expect(
      sameOrigin(
        new Request("http://localhost", {
          headers: { host: "localhost", origin: "https://evil.invalid" },
        }),
      ),
    ).toBe(false);
    expect(sameOrigin(new Request("http://localhost"))).toBe(false);
    expect(
      sameOrigin(
        new Request("http://localhost", {
          headers: { host: "localhost", origin: "http://localhost" },
        }),
      ),
    ).toBe(true);
  });
  it("bounds login attempts without unbounded keys", () => {
    for (let i = 0; i < 10; i++) expect(allowLogin(100000)).toBe(true);
    expect(allowLogin(100001)).toBe(false);
    expect(allowLogin(160001)).toBe(true);
  });
  it("validates drafts and rejects incomplete publishing and float inputs", () => {
    const value = {
      title: "Тест",
      slug: "test",
      baseServings: 4,
      status: "DRAFT",
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      ingredients: [],
      steps: [],
    };
    expect(recipeInput.safeParse(value).success).toBe(true);
    expect(
      recipeInput.safeParse({ ...value, status: "PUBLISHED" }).success,
    ).toBe(false);
    expect(
      recipeInput.safeParse({
        ...value,
        ingredients: [
          { ingredientId: randomUUID(), quantity: 0.1, unitId: randomUUID() },
        ],
      }).success,
    ).toBe(false);
    expect(
      ingredientInput.safeParse({ name: "Тест", slug: "test", nutrition: null })
        .success,
    ).toBe(true);
  });
  it("validates basket version and refuses corrupted or copied truth", () => {
    expect(parseBasket(null).items).toEqual([]);
    expect(() => parseBasket('{"schemaVersion":2,"items":[]}')).toThrow();
    expect(() => parseBasket("invalid")).toThrow();
    const item = {
      recipeId: randomUUID(),
      selectedServings: 4,
      addedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    expect(
      basketDocument.safeParse({ schemaVersion: 1, items: [item] }).success,
    ).toBe(true);
    expect(
      basketDocument.safeParse({ schemaVersion: 1, items: [item, item] })
        .success,
    ).toBe(false);
    expect(
      basketDocument.safeParse({
        schemaVersion: 1,
        items: [{ ...item, quantity: "100" }],
      }).success,
    ).toBe(false);
  });
  it("normalizes display only and preserves fractional count", () => {
    const q = new Decimal("1500");
    expect(displayQuantity(q, standardUnits.g)).toBe("1.5 кг");
    expect(q.toFixed()).toBe("1500");
    expect(displayQuantity(new Decimal("1000"), standardUnits.ml)).toBe("1 л");
    expect(displayQuantity(new Decimal("500"), standardUnits.ml)).toBe(
      "500 мл",
    );
    expect(displayQuantity(new Decimal("0.5"), standardUnits.pcs)).toBe(
      "0.5 шт.",
    );
  });
  it("rejects traversal and unknown media keys", () => {
    expect(() => mediaPath("/tmp", "../secret")).toThrow();
    expect(() => mediaPath("/tmp", "file.svg")).toThrow();
    expect(mediaPath("/tmp", randomUUID() + ".webp")).toContain(".webp");
  });
  it("reports unavailable media storage", async () => {
    vi.stubEnv("MEDIA_ROOT", "/nonexistent-recipes-test-" + randomUUID());
    await expect(checkMediaStorage()).rejects.toThrow();
    vi.unstubAllEnvs();
  });
});
