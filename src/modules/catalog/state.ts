import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import {
  catalogRevision,
  ingredientAliases,
  ingredientNutrition,
  ingredients,
} from "../../../db/schema";
import { Decimal } from "@/shared/decimal/decimal";
import { normalizeIngredientName } from "./normalization";
import { CatalogError } from "./input";

export type CatalogDatabase = ReturnType<typeof getDatabase>;
export type CatalogTransaction = Parameters<
  Parameters<CatalogDatabase["transaction"]>[0]
>[0];
export function hash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b, "en"))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function fileHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function sourceUuid(namespace: string, externalId: string) {
  const hex = hash([namespace, externalId]);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function nutritionSnapshot(
  n: typeof ingredientNutrition.$inferSelect | null,
) {
  return n
    ? {
        basisQuantity: new Decimal(n.basisQuantity).toFixed(6),
        basisUnitId: n.basisUnitId,
        caloriesKcal: new Decimal(n.caloriesKcal).toFixed(6),
        proteinG: new Decimal(n.proteinG).toFixed(6),
        fatG: new Decimal(n.fatG).toFixed(6),
        carbohydratesG: new Decimal(n.carbohydratesG).toFixed(6),
        sourceKind: n.sourceKind,
        sourceNote: n.sourceNote ?? "",
        sourceUrl: n.sourceUrl,
        sourceIdentifier: n.sourceIdentifier,
      }
    : null;
}
export function productSnapshot(
  i: typeof ingredients.$inferSelect,
  aliases: string[],
  n: typeof ingredientNutrition.$inferSelect | null,
) {
  return {
    name: i.name,
    slug: i.slug,
    categoryId: i.categoryId,
    aliases: [...aliases].sort((a, b) =>
      normalizeIngredientName(a).localeCompare(
        normalizeIngredientName(b),
        "en",
      ),
    ),
    nutrition: nutritionSnapshot(n),
  };
}
export async function readProduct(tx: CatalogTransaction, id: string) {
  const [i] = await tx.select().from(ingredients).where(eq(ingredients.id, id));
  if (!i) return null;
  const [n] = await tx
    .select()
    .from(ingredientNutrition)
    .where(eq(ingredientNutrition.ingredientId, id));
  const aliases = await tx
    .select()
    .from(ingredientAliases)
    .where(eq(ingredientAliases.ingredientId, id));
  return {
    ingredient: i,
    snapshot: productSnapshot(
      i,
      aliases.map((a) => a.name),
      n ?? null,
    ),
  };
}
export async function lockCatalog(tx: CatalogTransaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(672026)`);
  const [r] = await tx
    .select()
    .from(catalogRevision)
    .where(eq(catalogRevision.id, 1))
    .for("update");
  if (!r)
    throw new CatalogError(
      "Состояние каталога недоступно. Проверьте миграции тестовой базы.",
    );
}
export async function syncAliases(
  tx: CatalogTransaction,
  ingredientId: string,
  names: string[],
) {
  const existing = await tx
    .select()
    .from(ingredientAliases)
    .where(eq(ingredientAliases.ingredientId, ingredientId));
  const wanted = new Map(
    names.map((name) => [normalizeIngredientName(name), name]),
  );
  const removed = existing.filter((a) => !wanted.has(a.normalizedName!));
  if (removed.length)
    await tx.delete(ingredientAliases).where(
      inArray(
        ingredientAliases.id,
        removed.map((a) => a.id),
      ),
    );
  for (const [key, name] of wanted) {
    const old = existing.find((a) => a.normalizedName === key);
    if (!old) await tx.insert(ingredientAliases).values({ ingredientId, name });
    else if (old.name !== name)
      await tx
        .update(ingredientAliases)
        .set({ name })
        .where(eq(ingredientAliases.id, old.id));
  }
}
