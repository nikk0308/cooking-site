import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import {
  catalogImportRuns,
  catalogRevision,
  catalogSourceRecords,
  ingredientAliases,
  ingredientCategories,
  ingredientNutrition,
  ingredients,
  units,
} from "../../../db/schema";
import { Decimal } from "@/shared/decimal/decimal";
import { decodeImport } from "./import-format";
import { CatalogError, importDecisions, type ImportDecisions } from "./input";
import { normalizeIngredientName } from "./normalization";
import {
  fileHash,
  hash,
  lockCatalog,
  readProduct,
  sourceUuid,
  syncAliases,
  type CatalogTransaction,
} from "./state";

type Status = "CREATE" | "UPDATE" | "UNCHANGED" | "CONFLICT" | "INVALID";
type Snapshot = NonNullable<
  Awaited<ReturnType<typeof readProduct>>
>["snapshot"];
export type ImportRow = {
  row: number;
  externalId: string;
  status: Status;
  messages: string[];
  ingredientId?: string;
  matches?: { id: string; name: string; slug: string }[];
  before?: Snapshot;
  after?: Snapshot;
  category?: { id: string; name: string; slug: string };
  mode?: "SOURCE" | "LINK_ONLY";
  mappingExists?: boolean;
};
export type ImportPlan = {
  namespace: string;
  batch?: string;
  fileHash: string;
  revision: string;
  hash: string;
  rows: ImportRow[];
  counts: Record<Status, number>;
  canApply: boolean;
  affected: { categories: number; aliases: number; nutrition: number };
};

async function plan(
  tx: CatalogTransaction,
  bytes: Uint8Array,
  format: "csv" | "json",
  decisions: ImportDecisions,
): Promise<ImportPlan> {
  const envelope = decodeImport(bytes, format);
  const [revision] = await tx
    .select()
    .from(catalogRevision)
    .where(eq(catalogRevision.id, 1));
  if (!revision) throw new CatalogError("Миграция каталога не применена.");
  const unitCodes = [
    ...new Set(
      envelope.records.flatMap((r) =>
        r.result.success && r.result.data.nutrition
          ? [r.result.data.nutrition.basisUnit]
          : [],
      ),
    ),
  ];
  const allUnits = unitCodes.length
    ? await tx
        .select()
        .from(units)
        .where(inArray(units.code, unitCodes))
        .limit(500)
    : [];
  const rows: ImportRow[] = [];
  const seen = new Set<string>(),
    slugs = new Map<string, string>();
  const proposedCategories = new Map<string, { name: string; slug: string }>();
  for (const input of envelope.records) {
    if (!input.result.success) {
      rows.push({
        row: input.row,
        externalId: "",
        status: "INVALID",
        messages: input.result.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      });
      continue;
    }
    const r = input.result.data;
    const row: ImportRow = {
      row: input.row,
      externalId: r.externalId,
      status: "CONFLICT",
      messages: [],
    };
    rows.push(row);
    if (seen.has(r.externalId)) {
      row.messages.push("Повтор externalId в файле.");
      continue;
    }
    seen.add(r.externalId);
    if (
      r.nutrition &&
      !allUnits.some((u) => u.code === r.nutrition!.basisUnit)
    ) {
      row.status = "INVALID";
      row.messages.push("Неизвестная basisUnit.");
      continue;
    }
    const [mapping] = await tx
      .select()
      .from(catalogSourceRecords)
      .where(
        and(
          eq(catalogSourceRecords.namespace, envelope.namespace),
          eq(catalogSourceRecords.externalId, r.externalId),
        ),
      );
    const choice = Object.hasOwn(decisions, r.externalId)
      ? decisions[r.externalId]
      : undefined;
    row.mappingExists = !!mapping;
    row.ingredientId =
      mapping?.ingredientId ?? sourceUuid(envelope.namespace, r.externalId);
    row.mode = mapping?.mode ?? "SOURCE";
    if (!mapping && (await readProduct(tx, row.ingredientId))) {
      row.messages.push(
        "Предложенный UUID существует без записи источника. Требуется явная проверка связи.",
      );
      continue;
    }
    let current = mapping ? await readProduct(tx, mapping.ingredientId) : null;
    if (mapping && !current)
      throw new CatalogError("Повреждена ссылка источника. Импорт остановлен.");
    if (mapping?.mode === "LINK_ONLY") {
      row.status = "UNCHANGED";
      row.before = current!.snapshot;
      row.messages.push(
        "Только связь с существующим продуктом: его данные не изменяются.",
      );
      continue;
    }
    if (!mapping && typeof choice === "object") {
      current = await readProduct(tx, choice.link);
      if (!current) {
        row.messages.push("Продукт для явной связи не найден.");
        continue;
      }
      const owners = await tx
        .select()
        .from(catalogSourceRecords)
        .where(eq(catalogSourceRecords.ingredientId, choice.link));
      if (
        owners.length ||
        rows.some((x) => x !== row && x.ingredientId === choice.link)
      ) {
        row.messages.push("Этот UUID уже связан с другой записью источника.");
        continue;
      }
      row.ingredientId = choice.link;
      row.mode = "LINK_ONLY";
      row.matches = [
        {
          id: current.ingredient.id,
          name: current.ingredient.name,
          slug: current.ingredient.slug,
        },
      ];
      row.before = current.snapshot;
      row.status = "UPDATE";
      row.messages.push("Явная связь без изменения существующих полей и КБЖУ.");
      continue;
    }
    if (mapping && choice === "KEEP") {
      row.status = "UNCHANGED";
      row.before = current!.snapshot;
      row.messages.push("Существующие данные сохранены по явному выбору.");
      continue;
    }
    let categoryId: string | null = null;
    if (r.category) {
      const normalized = normalizeIngredientName(r.category.name);
      const categories = await tx
        .select()
        .from(ingredientCategories)
        .where(
          or(
            eq(ingredientCategories.slug, r.category.slug),
            eq(ingredientCategories.normalizedName, normalized),
          ),
        )
        .limit(2);
      if (
        categories.some(
          (c) => c.slug !== r.category!.slug || c.normalizedName !== normalized,
        )
      ) {
        row.messages.push(
          "Конфликт имени/slug категории. Переименование выполняется отдельно.",
        );
        continue;
      }
      const proposed = [...proposedCategories.values()].find(
        (c) =>
          c.slug === r.category!.slug ||
          normalizeIngredientName(c.name) === normalized,
      );
      if (
        proposed &&
        (proposed.slug !== r.category.slug ||
          normalizeIngredientName(proposed.name) !== normalized)
      ) {
        row.messages.push("Разные определения категории в файле.");
        continue;
      }
      categoryId = categories[0]?.id ?? sourceUuid("category", r.category.slug);
      if (!categories.length) row.category = { id: categoryId, ...r.category };
      proposedCategories.set(r.category.slug, r.category);
    }
    const slug =
      r.slug ??
      current?.snapshot.slug ??
      `source-${hash([envelope.namespace, r.externalId]).slice(0, 24)}`;
    if (mapping && r.slug && r.slug !== current!.snapshot.slug) {
      row.messages.push(
        "Изменение существующего slug требует отдельного редактирования ингредиента.",
      );
      continue;
    }
    const conflictingSlug = await tx
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.slug, slug));
    if (
      conflictingSlug.some((i) => i.id !== row.ingredientId) ||
      (slugs.has(slug) && slugs.get(slug) !== r.externalId)
    ) {
      row.messages.push("Slug принадлежит другому продукту.");
      continue;
    }
    slugs.set(slug, r.externalId);
    const aliases = [
      ...new Map(
        r.aliases.map((a) => [normalizeIngredientName(a), a]),
      ).values(),
    ].sort((a, b) =>
      normalizeIngredientName(a).localeCompare(
        normalizeIngredientName(b),
        "en",
      ),
    );
    if (aliases.length !== r.aliases.length)
      row.messages.push("Повторяющиеся нормализованные синонимы исключены.");
    const names = [
      ...new Set([r.name, ...aliases].map(normalizeIngredientName)),
    ];
    if (!mapping) {
      const matches = await tx
        .select({
          id: ingredients.id,
          name: ingredients.name,
          slug: ingredients.slug,
        })
        .from(ingredients)
        .where(
          or(
            inArray(ingredients.normalizedName, names),
            sql`${ingredients.id} IN (SELECT ${ingredientAliases.ingredientId} FROM ${ingredientAliases} WHERE ${inArray(ingredientAliases.normalizedName, names)})`,
          ),
        )
        .limit(51);
      const fileMatches = rows.filter(
        (x) =>
          x !== row &&
          x.after &&
          [x.after.name, ...x.after.aliases].some((n) =>
            names.includes(normalizeIngredientName(n)),
          ),
      );
      row.matches = matches;
      if ((matches.length || fileMatches.length) && choice !== "DISTINCT") {
        row.messages.push(
          "Совпадение названия/синонима: выберите отдельный продукт или явно свяжите существующий UUID. Совпадение текста не определяет идентичность.",
        );
        continue;
      }
    }
    let nutrition: Snapshot["nutrition"] = null;
    if (r.nutrition) {
      const n = r.nutrition,
        unit = allUnits.find((u) => u.code === n.basisUnit);
      if (!unit) {
        row.status = "INVALID";
        row.messages.push("Неизвестная basisUnit.");
        continue;
      }
      nutrition = {
        basisQuantity: new Decimal(n.basisQuantity).toFixed(6),
        basisUnitId: unit.id,
        caloriesKcal: new Decimal(n.caloriesKcal).toFixed(6),
        proteinG: new Decimal(n.proteinG).toFixed(6),
        fatG: new Decimal(n.fatG).toFixed(6),
        carbohydratesG: new Decimal(n.carbohydratesG).toFixed(6),
        sourceKind: n.sourceKind,
        sourceNote: n.sourceNote,
        sourceUrl: n.sourceUrl,
        sourceIdentifier: n.sourceIdentifier,
      };
    }
    row.after = { name: r.name, slug, categoryId, aliases, nutrition };
    if (current) {
      row.before = current.snapshot;
      if (hash(current.snapshot) === hash(row.after)) row.status = "UNCHANGED";
      else if (
        mapping?.appliedHash !== hash(current.snapshot) &&
        choice !== "REPLACE"
      ) {
        row.messages.push(
          "Продукт изменён после импорта. Выберите KEEP или явную замену REPLACE.",
        );
      } else row.status = "UPDATE";
    } else row.status = "CREATE";
  }
  // Any repeated external ID invalidates all occurrences, not just the second one.
  for (const row of rows)
    if (
      row.externalId &&
      rows.filter((r) => r.externalId === row.externalId).length > 1
    ) {
      row.status = "CONFLICT";
      row.messages.push("Дублирующийся externalId.");
    }
  const counts = {
    CREATE: 0,
    UPDATE: 0,
    UNCHANGED: 0,
    CONFLICT: 0,
    INVALID: 0,
  };
  for (const r of rows) counts[r.status]++;
  const changed = rows.filter(
    (r) => r.status === "CREATE" || r.status === "UPDATE",
  );
  const base = {
    namespace: envelope.namespace,
    ...(envelope.batch ? { batch: envelope.batch } : {}),
    fileHash: fileHash(bytes),
    revision: revision.revision.toString(),
    rows,
    counts,
    canApply: counts.CONFLICT + counts.INVALID === 0,
    affected: {
      categories: new Set(
        changed.flatMap((r) => (r.category ? [r.category.id] : [])),
      ).size,
      aliases: changed.reduce((n, r) => n + (r.after?.aliases.length ?? 0), 0),
      nutrition: changed.filter(
        (r) =>
          r.after &&
          hash(r.after.nutrition) !== hash(r.before?.nutrition ?? null),
      ).length,
    },
  };
  return { ...base, hash: hash({ format, decisions, ...base }) };
}

export function catalogImporter(db = getDatabase()) {
  return {
    preview(
      bytes: Uint8Array,
      format: "csv" | "json",
      rawDecisions: unknown = {},
    ) {
      const decisions = importDecisions.parse(rawDecisions);
      return db.transaction((tx) => plan(tx, bytes, format, decisions), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    async apply(
      bytes: Uint8Array,
      format: "csv" | "json",
      expected: string,
      rawDecisions: unknown = {},
    ) {
      const decisions = importDecisions.parse(rawDecisions);
      if (!/^[a-f0-9]{64}$/.test(expected))
        throw new CatalogError("Нужен fingerprint подтверждённого preview.");
      return db.transaction(async (tx) => {
        await lockCatalog(tx);
        const fresh = await plan(tx, bytes, format, decisions);
        if (fresh.hash !== expected)
          throw new CatalogError(
            "STALE_PLAN: файл или каталог изменён. Сформируйте новый preview.",
          );
        if (!fresh.canApply)
          throw new CatalogError(
            "Исправьте все INVALID/CONFLICT до применения.",
          );
        const categoryIds = new Set<string>();
        for (const r of fresh.rows) {
          if (r.status !== "CREATE" && r.status !== "UPDATE") continue;
          if (r.category && !categoryIds.has(r.category.id)) {
            await tx.insert(ingredientCategories).values(r.category);
            categoryIds.add(r.category.id);
          }
          const id = r.ingredientId!;
          if (r.mode !== "LINK_ONLY") {
            const a = r.after!;
            if (r.status === "CREATE")
              await tx.insert(ingredients).values({
                id,
                name: a.name,
                slug: a.slug,
                categoryId: a.categoryId,
              });
            else
              await tx
                .update(ingredients)
                .set({
                  name: a.name,
                  slug: a.slug,
                  categoryId: a.categoryId,
                  updatedAt: new Date(),
                })
                .where(eq(ingredients.id, id));
            await syncAliases(tx, id, a.aliases);
            if (a.nutrition)
              await tx
                .insert(ingredientNutrition)
                .values({ ingredientId: id, ...a.nutrition })
                .onConflictDoUpdate({
                  target: ingredientNutrition.ingredientId,
                  set: { ...a.nutrition, updatedAt: new Date() },
                });
            else
              await tx
                .delete(ingredientNutrition)
                .where(eq(ingredientNutrition.ingredientId, id));
          }
          const appliedHash = hash(r.after ?? r.before);
          await tx
            .insert(catalogSourceRecords)
            .values({
              namespace: fresh.namespace,
              externalId: r.externalId,
              ingredientId: id,
              mode: r.mode!,
              appliedHash,
            })
            .onConflictDoUpdate({
              target: [
                catalogSourceRecords.namespace,
                catalogSourceRecords.externalId,
              ],
              set: { appliedHash, updatedAt: new Date() },
            });
        }
        if (fresh.counts.CREATE + fresh.counts.UPDATE)
          await tx.insert(catalogImportRuns).values({
            namespace: fresh.namespace,
            fileHash: fresh.fileHash,
            planHash: fresh.hash,
            batch: fresh.batch,
            rowCount: fresh.rows.length,
            report: JSON.stringify({
              counts: fresh.counts,
              rows: fresh.rows.map((r) => ({
                row: r.row,
                externalId: r.externalId,
                status: r.status,
                ingredientId: r.ingredientId,
              })),
            }),
          });
        return {
          planHash: fresh.hash,
          counts: fresh.counts,
          committed: true as const,
        };
      });
    },
  };
}
