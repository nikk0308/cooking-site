import { describe, expect, it } from "vitest";
import { isPublicRecipeStatus } from "@/modules/recipes/publication";
import { createSlug } from "@/modules/recipes/slug";

describe("recipe slug", () => {
  it.each([
    ["Сырники из творога", "syrniki-iz-tvoroga"],
    ["  Молоко 2.5%  ", "moloko-2-5"],
    ["Ёжики — по-домашнему!", "ezhiki-po-domashnemu"],
  ])("transliterates %s", (source, expected) =>
    expect(createSlug(source)).toBe(expected),
  );
});

describe("public recipe boundary", () => {
  it("only permits published recipes", () => {
    expect(isPublicRecipeStatus("DRAFT")).toBe(false);
    expect(isPublicRecipeStatus("PUBLISHED")).toBe(true);
    expect(isPublicRecipeStatus("ARCHIVED")).toBe(false);
  });
});
