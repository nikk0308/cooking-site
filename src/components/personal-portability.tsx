"use client";
import { useState } from "react";
import { browserError, useBrowserData } from "./browser-data";
import {
  exportBrowserData,
  prepareImport,
} from "@/platform/browser/portability";
export function PortabilityPanel() {
  const { repo, notify } = useBrowserData();
  const [preview, setPreview] = useState<Awaited<
      ReturnType<typeof prepareImport>
    > | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [lastFile, setLastFile] = useState<File | null>(null);
  async function inspect(file: File) {
    if (!repo) return;
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    setLastFile(file);
    try {
      setPreview(await prepareImport(file, repo));
    } catch (e) {
      setError(browserError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-labelledby="portability-title">
      <h2 id="portability-title">Резервная копия личных данных</h2>
      {/* Firefox restores dynamic disabled states across reloads unless the
          owning form opts out. Readiness must come only from this repository. */}
      <form autoComplete="off" onSubmit={(event) => event.preventDefault()}>
        <p>
          Файл содержит личные рецепты, фотографии, избранное и shopping v2. Не
          публикуйте его. Старая корзина v1 не входит в файл и не очищается; её
          перенос доступен на странице «Список продуктов».
        </p>
        <p>
          Лимит файла — 64 МиБ, фотографий в backup — 40 МиБ. Если полный
          экспорт невозможен, он завершится ошибкой, ничего не пропуская.
        </p>
        <button
          type="button"
          disabled={!repo || busy}
          onClick={async () => {
            if (!repo) return;
            setBusy(true);
            setError("");
            try {
              const data = await exportBrowserData(repo),
                url = URL.createObjectURL(data.blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = data.filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
              setMessage(
                `Экспортировано: ${new Date(data.date).toLocaleString("ru-RU")}. Сохраните файл вне данных браузера.`,
              );
            } catch (e) {
              setError(browserError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Экспортировать все личные данные
        </button>
        <label>
          Восстановить из backup JSON
          <input
            type="file"
            autoComplete="off"
            accept="application/json,.json"
            disabled={!repo || busy}
            onChange={async (e) => {
              const input = e.currentTarget,
                file = input.files?.[0];
              if (file) await inspect(file);
              input.value = "";
            }}
          />
        </label>
        {busy && <p aria-live="polite">Проверка и обработка данных…</p>}
        {error && <p role="alert">{error}</p>}
        <p role="status">{message}</p>
        {preview && (
          <section aria-label="Предпросмотр импорта">
            <h3>Предпросмотр импорта</h3>
            <p>
              Дата backup:{" "}
              {new Date(preview.summary.date).toLocaleString("ru-RU")}
            </p>
            <ul>
              <li>Новых рецептов: {preview.summary.recipes}</li>
              <li>Идентичных рецептов пропущено: {preview.summary.skipped}</li>
              <li>Новых фотографий: {preview.summary.photos}</li>
              <li>Избранных ссылок в файле: {preview.summary.favorites}</li>
              <li>Строк shopping v2 в файле: {preview.summary.shoppingRows}</li>
              <li>Размер файла: {preview.summary.bytes} байт</li>
              <li>Конфликтов: {preview.summary.conflicts.length}</li>
            </ul>
            {preview.summary.conflicts.length > 0 && (
              <div role="alert">
                <p>
                  Импорт невозможен без перезаписи. Текущие записи не будут
                  изменены.
                </p>
                <ul>
                  {preview.summary.conflicts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              Новые ID добавляются. Существующие данные сохраняются; идентичные
              записи пропускаются. Различающиеся непустые списки покупок не
              объединяются автоматически.
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={busy || preview.summary.conflicts.length > 0}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await preview.confirm();
                    notify();
                    setMessage(
                      `Импорт завершён. Добавлено рецептов: ${preview.summary.recipes}. Существующие данные сохранены.`,
                    );
                    setPreview(null);
                  } catch (e) {
                    setError(browserError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Подтвердить импорт
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Отменить импорт
              </button>
            </div>
          </section>
        )}
        {error && lastFile && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              void inspect(lastFile);
            }}
          >
            Повторить предпросмотр
          </button>
        )}
      </form>
    </section>
  );
}
