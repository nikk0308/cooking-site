"use client";
import { useState } from "react";
import type { ImportPlan } from "@/modules/catalog/importer";
import type { ImportDecisions } from "@/modules/catalog/input";
import { importMaxBytes, reportCsv } from "@/modules/catalog/import-format";
import { useCatalogReady } from "./catalog-admin-forms";
export function CatalogImportForm() {
  const ready = useCatalogReady();
  const [file, setFile] = useState<File | null>(null),
    [plan, setPlan] = useState<ImportPlan | null>(null),
    [decisions, setDecisions] = useState<ImportDecisions>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [applied, setApplied] = useState(false);
  async function request(action: "preview" | "apply") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > importMaxBytes || !file.size)
        throw new Error("Допустим файл от 1 байта до 1 МиБ.");
      const format = file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : file.name.toLowerCase().endsWith(".json")
          ? "json"
          : null;
      if (!format) throw new Error("Выберите CSV или JSON версии 1.");
      const encodedDecisions = encodeURIComponent(JSON.stringify(decisions));
      if (encodedDecisions.length > 8192)
        throw new Error(
          "Слишком много решений в части. Разделите файл на меньшие части и повторите preview.",
        );
      const response = await fetch(
        `/api/admin/ingredients/import?format=${format}&action=${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Catalog-Plan": plan?.hash ?? "",
            "X-Catalog-Decisions": encodedDecisions,
          },
          body: file,
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error([data.error, ...(data.fields ?? [])].join("\n"));
      if (action === "preview") {
        setPlan(data);
        setApplied(false);
        setMessage("Preview готов. Каталог не изменён.");
      } else {
        setApplied(true);
        setMessage(
          `Импорт сохранён: новых ${data.counts.CREATE}, обновлено ${data.counts.UPDATE}, без изменений ${data.counts.UNCHANGED}.`,
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
      if (action === "apply") setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string, value: string) {
    const next: ImportDecisions = Object.fromEntries(
      Object.entries(decisions).filter(([key]) => key !== id),
    );
    if (!value) setDecisions(next);
    else {
      const selected = value.startsWith("link:")
        ? { link: value.slice(5) }
        : (value as "DISTINCT" | "KEEP" | "REPLACE");
      setDecisions({ ...next, [id]: selected });
    }
    setMessage("Решение изменено. Повторите preview перед подтверждением.");
    setPlan((old) => (old ? { ...old, canApply: false } : null));
  }
  const decisionFor = (id: string) =>
    Object.hasOwn(decisions, id) ? decisions[id] : undefined;
  return (
    <section>
      <p>
        Часть: до 500 записей, UTF-8, до 1 МиБ. Вся часть применяется атомарно.
        Для больших наборов используйте несколько частей с отдельным preview и
        подтверждением каждой.
      </p>
      <p>
        <a href="/catalog-import-template.csv" download>
          Шаблон CSV
        </a>{" "}
        ·{" "}
        <a href="/catalog-import-example.json" download>
          Пример JSON — синтетические тестовые данные
        </a>
      </p>
      <label>
        Файл каталога
        <input
          type="file"
          accept=".csv,.json"
          disabled={!ready || busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPlan(null);
            setDecisions({});
            setApplied(false);
            setMessage("");
          }}
        />
      </label>
      <button
        type="button"
        disabled={!ready || busy || !file}
        onClick={() => void request("preview")}
      >
        {busy ? "Обработка…" : "Проверить файл — preview"}
      </button>
      <p role="status" style={{ whiteSpace: "pre-wrap" }}>
        {message}
      </p>
      {plan && (
        <>
          <h2>План импорта</h2>
          <p>
            Строк: {plan.rows.length}; CREATE: {plan.counts.CREATE}; UPDATE:{" "}
            {plan.counts.UPDATE}; UNCHANGED: {plan.counts.UNCHANGED}; CONFLICT:{" "}
            {plan.counts.CONFLICT}; INVALID: {plan.counts.INVALID}.
          </p>
          <p>
            Новых категорий: {plan.affected.categories}; синонимов в изменяемых
            записях: {plan.affected.aliases}; изменяемых профилей КБЖУ:{" "}
            {plan.affected.nutrition}.
          </p>
          <p style={{ overflowWrap: "anywhere" }}>
            Fingerprint: <code>{plan.hash}</code>
          </p>
          <ol>
            {plan.rows.map((r, index) => (
              <li key={index} className="panel">
                <strong>
                  Строка {r.row}: {r.externalId || "невалидная запись"} —{" "}
                  {r.status}
                </strong>
                {r.messages.map((m, i) => (
                  <p key={i}>{m}</p>
                ))}
                {(r.status === "CONFLICT" || decisionFor(r.externalId)) &&
                  r.externalId && (
                    <label>
                      Решение для {r.externalId}
                      <select
                        aria-label={`Решение для ${r.externalId}`}
                        disabled={busy || applied}
                        value={
                          typeof decisionFor(r.externalId) === "object"
                            ? `link:${(decisionFor(r.externalId) as { link: string }).link}`
                            : ((decisionFor(r.externalId) as string) ?? "")
                        }
                        onChange={(e) => choose(r.externalId, e.target.value)}
                      >
                        <option value="">Исправить файл / не применять</option>
                        {!r.mappingExists && (
                          <option value="DISTINCT">
                            Это отдельный продукт (новый UUID)
                          </option>
                        )}
                        {r.mappingExists && (
                          <>
                            <option value="KEEP">
                              Сохранить текущие данные
                            </option>
                            <option value="REPLACE">
                              Явно заменить данными этого источника
                            </option>
                          </>
                        )}
                        {!r.mappingExists &&
                          r.matches?.map((m) => (
                            <option key={m.id} value={`link:${m.id}`}>
                              Связать без замены полей: {m.name} ({m.slug})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                {(r.before || r.after) && (
                  <details>
                    <summary>Сравнить данные и происхождение КБЖУ</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(
                        { before: r.before ?? null, after: r.after ?? null },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={busy || !plan.canApply || applied}
            onClick={() => {
              if (
                window.confirm(
                  `Применить проверенный план (${plan.rows.length} строк)? Изменения этой части будут атомарными.`,
                )
              )
                void request("apply");
            }}
          >
            Подтвердить импорт
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([reportCsv(plan.rows)], {
                  type: "text/csv;charset=utf-8",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `culinote-import-${applied ? "committed" : "preview"}.csv`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            Скачать отчёт {applied ? "о сохранении" : "preview"}
          </button>
        </>
      )}
    </section>
  );
}
