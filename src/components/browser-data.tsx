"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { openBrowserRepository } from "@/platform/browser/repository";
import { BrowserStorageError } from "@/platform/browser/database";
import { PortabilityError } from "@/platform/browser/portability";
import { PhotoError } from "@/platform/browser/images";
import { ShoppingError } from "@/modules/shopping/operations";
type Repo = Awaited<ReturnType<typeof openBrowserRepository>>;
type State = {
  repo: Repo | null;
  error: string;
  revision: number;
  notify: () => void;
};
const Context = createContext<State>({
  repo: null,
  error: "",
  revision: 0,
  notify() {},
});
export const useBrowserData = () => useContext(Context);
export function browserError(error: unknown): string {
  if (
    error instanceof PortabilityError ||
    error instanceof PhotoError ||
    error instanceof ShoppingError
  )
    return error.message;
  if (error instanceof BrowserStorageError)
    return {
      UNAVAILABLE:
        "Хранилище браузера недоступно. Разрешите данные сайта, проверьте приватный режим и повторите. Не очищайте данные сайта.",
      QUOTA:
        "В браузере недостаточно места. Ранее сохранённые данные не заменены. Освободите место вне данных Culinote и повторите.",
      CORRUPTED:
        "В хранилище обнаруждены повреждённые данные. Ничего не очищено. Сохраните профиль браузера для восстановления.",
      UNSUPPORTED_VERSION:
        "Данные созданы более новой версией Culinote. Обновите приложение; не очищайте хранилище.",
      UPGRADE_FAILED:
        "Не удалось обновить хранилище. Предыдущие данные сохранены. Закройте другие вкладки и повторите.",
      BLOCKED:
        "Обновление хранилища заблокировано другой вкладкой. Закройте её и повторите без очистки данных.",
      VERIFY_FAILED:
        "Данные изменились в другой вкладке. Обновите список или предпросмотр; в редакторе сохраните текст правок и перечитайте рецепт. Ничего не перезаписано.",
      CAPACITY:
        "Достигнут лимит 500 личных рецептов. Сначала сохраните backup; ничего не удалено автоматически.",
    }[error.code];
  return "Не удалось выполнить действие. Проверьте поля и доступность хранилища, затем повторите. Существующие данные не очищены.";
}
export function BrowserDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ repo: Repo | null; error: string }>({
    repo: null,
    error: "",
  });
  const [retry, setRetry] = useState(0),
    [revision, setRevision] = useState(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const notify = useCallback(() => {
    setRevision((v) => v + 1);
    channel.current?.postMessage("changed");
  }, []);
  useEffect(() => {
    let active = true,
      current: Repo | undefined;
    openBrowserRepository()
      .then((repo) => {
        current = repo;
        if (active) setState({ repo, error: "" });
        else repo.close();
      })
      .catch((e) => {
        if (active) setState({ repo: null, error: browserError(e) });
      });
    return () => {
      active = false;
      current?.close();
    };
  }, [retry]);
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel.current = new BroadcastChannel("culinote-browser-events");
        channel.current.onmessage = refresh;
      }
    } catch {
      channel.current = null;
    }
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      channel.current?.close();
      channel.current = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return (
    <Context.Provider value={{ ...state, revision, notify }}>
      {state.error && (
        <div className="storage-notice" role="alert">
          {state.error}{" "}
          <button
            onClick={() => {
              setState({ repo: null, error: "" });
              setRetry((v) => v + 1);
            }}
          >
            Повторить доступ
          </button>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
