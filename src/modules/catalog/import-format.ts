import { CatalogError, importEnvelope, importRecord } from "./input";
export const importMaxBytes = 1024 * 1024;
export const csvColumns = [
  "schemaVersion",
  "namespace",
  "externalId",
  "name",
  "slug",
  "categorySlug",
  "categoryName",
  "aliases",
  "basisQuantity",
  "basisUnit",
  "caloriesKcal",
  "proteinG",
  "fatG",
  "carbohydratesG",
  "sourceKind",
  "sourceNote",
  "sourceUrl",
  "sourceIdentifier",
] as const;
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const end = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        throw new CatalogError(
          `CSV: неверная кавычка, строка ${rows.length + 1}`,
        );
      quoted = true;
    } else if (c === ",") end();
    else if (c === "\r" || c === "\n") {
      if (c === "\r") {
        if (text[i + 1] !== "\n")
          throw new CatalogError("CSV: используйте LF или CRLF");
        i++;
      }
      end();
      rows.push(row);
      row = [];
    } else {
      if (closed)
        throw new CatalogError("CSV: символ после закрывающей кавычки");
      cell += c;
    }
    if (
      cell.length > 16000 ||
      row.length > csvColumns.length ||
      rows.length > 501
    )
      throw new CatalogError("CSV превышает лимит полей/строк");
  }
  if (quoted) throw new CatalogError("CSV: незакрытая кавычка");
  if (cell || row.length || closed) {
    end();
    rows.push(row);
  }
  return rows;
}
export function decodeImport(bytes: Uint8Array, format: "csv" | "json") {
  if (!bytes.length || bytes.length > importMaxBytes)
    throw new CatalogError(
      "Файл должен быть от 1 байта до 1 МиБ; максимум 500 записей в атомарной части",
    );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CatalogError("Файл должен быть корректным UTF-8");
  }
  if (text.includes("\0"))
    throw new CatalogError("Нулевой символ в файле запрещён");
  let raw: unknown;
  try {
    if (format === "json") raw = JSON.parse(text);
    else {
      const [header, ...rows] = parseCsv(text);
      if (JSON.stringify(header) !== JSON.stringify(csvColumns))
        throw new CatalogError(
          "CSV: нужны точные столбцы из шаблона, разделитель — запятая",
        );
      let namespace: string | undefined;
      raw = {
        application: "culinote-catalog",
        schemaVersion: 1,
        records: rows.map((r, i) => {
          if (r.length !== csvColumns.length)
            throw new CatalogError(
              `CSV: неверное число столбцов, строка ${i + 2}`,
            );
          const v = Object.fromEntries(csvColumns.map((key, j) => [key, r[j]]));
          if (v.schemaVersion !== "1")
            throw new CatalogError(
              `CSV: неподдерживаемая версия, строка ${i + 2}`,
            );
          if (namespace !== undefined && namespace !== v.namespace)
            throw new CatalogError("В одном файле только один namespace");
          namespace = v.namespace;
          const nutritionKeys = [
            "basisQuantity",
            "basisUnit",
            "caloriesKcal",
            "proteinG",
            "fatG",
            "carbohydratesG",
            "sourceKind",
            "sourceNote",
            "sourceUrl",
            "sourceIdentifier",
          ];
          return {
            externalId: v.externalId,
            name: v.name,
            ...(v.slug ? { slug: v.slug } : {}),
            category:
              v.categorySlug || v.categoryName
                ? { slug: v.categorySlug, name: v.categoryName }
                : null,
            aliases: v.aliases ? JSON.parse(v.aliases) : [],
            nutrition: nutritionKeys.every((k) => !v[k])
              ? null
              : {
                  ...Object.fromEntries(nutritionKeys.map((k) => [k, v[k]])),
                  sourceUrl: v.sourceUrl || null,
                  sourceIdentifier: v.sourceIdentifier || null,
                },
          };
        }),
      };
      (raw as { namespace?: string }).namespace = namespace;
    }
  } catch (e) {
    if (e instanceof CatalogError) throw e;
    throw new CatalogError(
      "Не удалось разобрать JSON/CSV: проверьте синтаксис и JSON-массив синонимов",
    );
  }
  const envelope = importEnvelope.safeParse(raw);
  if (!envelope.success)
    throw new CatalogError(
      "Неподдерживаемый envelope: application/schemaVersion/namespace, от 1 до 500 records. Используйте шаблон версии 1",
    );
  return {
    ...envelope.data,
    records: envelope.data.records.map((r, i) => ({
      row: i + (format === "csv" ? 2 : 1),
      result: importRecord.safeParse(r),
    })),
  };
}
export function reportCsv(
  rows: {
    row: number;
    externalId: string;
    status: string;
    messages: string[];
  }[],
) {
  const cell = (v: string) =>
    `"${(/^[\s]*[=+\-@\t\r]/.test(v) ? "'" : "") + v.replaceAll('"', '""')}"`;
  return (
    "\ufeff" +
    [
      ["row", "externalId", "status", "messages"],
      ...rows.map((r) => [
        String(r.row),
        r.externalId,
        r.status,
        r.messages.join("; "),
      ]),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
