import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "@/platform/db/client";
import {
  ingredientCategories,
  ingredientNutrition,
  ingredients,
  units,
} from "../../../db/schema";
import { catalogIngredientInput, categoryInput, CatalogError } from "./input";
import { hash, lockCatalog, readProduct, syncAliases } from "./state";

export function catalogAdmin(db = getDatabase()) {
  return {
    async get(id: string) {
      return db.transaction(async (tx) => {
        const p = await readProduct(tx, z.uuid().parse(id));
        return p
          ? { ...p.snapshot, id: p.ingredient.id, expected: hash(p.snapshot) }
          : null;
      });
    },
    async save(raw: unknown) {
      const v = catalogIngredientInput.parse(raw);
      return db.transaction(async (tx) => {
        await lockCatalog(tx);
        const old = v.id ? await readProduct(tx, v.id) : null;
        if (v.id && !old)
          throw new CatalogError("Ингредиент больше не существует.");
        if (v.expected && old && hash(old.snapshot) !== v.expected)
          throw new CatalogError(
            "Запись изменена. Обновите страницу перед сохранением.",
          );
        if (
          v.nutrition === null &&
          old?.snapshot.nutrition &&
          !v.removeNutrition
        )
          throw new CatalogError("Подтвердите удаление КБЖУ отдельно.");
        if (
          v.categoryId &&
          !(
            await tx
              .select({ id: ingredientCategories.id })
              .from(ingredientCategories)
              .where(eq(ingredientCategories.id, v.categoryId))
          ).length
        )
          throw new CatalogError("Категория не найдена.");
        if (
          v.nutrition &&
          !(
            await tx
              .select({ id: units.id })
              .from(units)
              .where(eq(units.id, v.nutrition.basisUnitId))
          ).length
        )
          throw new CatalogError("Неизвестная базовая единица КБЖУ.");
        const values = {
          name: v.name,
          slug: v.slug,
          ...(v.categoryId !== undefined ? { categoryId: v.categoryId } : {}),
          updatedAt: new Date(),
        };
        const [saved] = v.id
          ? await tx
              .update(ingredients)
              .set(values)
              .where(eq(ingredients.id, v.id))
              .returning()
          : await tx.insert(ingredients).values(values).returning();
        if (v.aliases !== undefined) await syncAliases(tx, saved.id, v.aliases);
        if (v.nutrition) {
          const n = {
            ...v.nutrition,
            ingredientId: saved.id,
            updatedAt: new Date(),
          };
          await tx.insert(ingredientNutrition).values(n).onConflictDoUpdate({
            target: ingredientNutrition.ingredientId,
            set: n,
          });
        } else if (v.nutrition === null)
          await tx
            .delete(ingredientNutrition)
            .where(eq(ingredientNutrition.ingredientId, saved.id));
        return {
          ...saved,
          expected: hash((await readProduct(tx, saved.id))!.snapshot),
        };
      });
    },
    async categories(query = "") {
      z.string().max(100).parse(query);
      const pattern = `%${query
        .normalize("NFKC")
        .toLowerCase()
        .replaceAll("ё", "е")
        .trim()
        .replace(/[\\%_]/g, "\\$&")}%`;
      return db
        .select({
          id: ingredientCategories.id,
          name: ingredientCategories.name,
          slug: ingredientCategories.slug,
          count: sql<number>`(SELECT count(*)::integer FROM ${ingredients} WHERE ${ingredients.categoryId}=${ingredientCategories.id})`,
        })
        .from(ingredientCategories)
        .where(
          sql`${ingredientCategories.normalizedName} LIKE ${pattern} ESCAPE '\'`,
        )
        .orderBy(
          asc(ingredientCategories.normalizedName),
          asc(ingredientCategories.id),
        )
        .limit(200);
    },
    async saveCategory(raw: unknown) {
      const v = categoryInput.parse(raw);
      return db.transaction(async (tx) => {
        await lockCatalog(tx);
        if (v.id) {
          const [old] = await tx
            .select()
            .from(ingredientCategories)
            .where(eq(ingredientCategories.id, v.id));
          if (!old) throw new CatalogError("Категория не найдена.");
          if (
            v.expected &&
            hash({ name: old.name, slug: old.slug }) !== v.expected
          )
            throw new CatalogError("Категория изменена. Обновите список.");
          return (
            await tx
              .update(ingredientCategories)
              .set({ name: v.name, slug: v.slug })
              .where(eq(ingredientCategories.id, v.id))
              .returning()
          )[0];
        }
        return (
          await tx
            .insert(ingredientCategories)
            .values({ name: v.name, slug: v.slug })
            .returning()
        )[0];
      });
    },
    async removeCategory(id: string) {
      z.uuid().parse(id);
      return db.transaction(async (tx) => {
        await lockCatalog(tx);
        // Lock the referenced row: concurrent FK inserts cannot race the emptiness check.
        const [category] = await tx
          .select()
          .from(ingredientCategories)
          .where(eq(ingredientCategories.id, id))
          .for("update");
        if (!category) throw new CatalogError("Категория не найдена.");
        if (
          (
            await tx
              .select({ id: ingredients.id })
              .from(ingredients)
              .where(and(eq(ingredients.categoryId, id)))
              .limit(1)
          ).length
        )
          throw new CatalogError(
            "Сначала явно переназначьте ингредиенты этой категории.",
          );
        await tx
          .delete(ingredientCategories)
          .where(eq(ingredientCategories.id, id));
      });
    },
  };
}
