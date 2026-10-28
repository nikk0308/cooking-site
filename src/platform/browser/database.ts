export class BrowserStorageError extends Error {
  constructor(
    public readonly code:
      | "UNAVAILABLE"
      | "QUOTA"
      | "CORRUPTED"
      | "UNSUPPORTED_VERSION"
      | "UPGRADE_FAILED"
      | "BLOCKED"
      | "VERIFY_FAILED"
      | "CAPACITY",
    options?: ErrorOptions,
  ) {
    super(`Browser storage: ${code}`, options);
  }
}
export function storageError(error: unknown): BrowserStorageError {
  if (error instanceof BrowserStorageError) return error;
  const name = (error as { name?: string })?.name;
  return new BrowserStorageError(
    name === "QuotaExceededError"
      ? "QUOTA"
      : name === "VersionError"
        ? "UNSUPPORTED_VERSION"
        : "UNAVAILABLE",
    { cause: error },
  );
}
export const browserDatabaseVersion = 2;
export function openBrowserDatabase(
  name = "culinote-browser",
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new BrowserStorageError("UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let upgradeError: unknown;
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, browserDatabaseVersion);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onblocked = () => {
      cancelled = true;
      reject(new BrowserStorageError("BLOCKED"));
    };
    request.onerror = () => reject(upgradeError ?? storageError(request.error));
    request.onupgradeneeded = () => {
      try {
        for (const [store, key] of [
          ["recipes", "reference.id"],
          ["documents", "key"],
          ["photos", "id"],
        ]) {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store, { keyPath: key });
          else if (request.transaction!.objectStore(store).keyPath !== key)
            throw new BrowserStorageError("UPGRADE_FAILED");
        }
      } catch (error) {
        upgradeError = storageError(error);
        request.transaction!.abort();
      }
    };
    request.onsuccess = () => {
      if (cancelled) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
const failures = new WeakMap<IDBTransaction, unknown>();
export function abort(tx: IDBTransaction, error: unknown) {
  failures.set(tx, error);
  tx.abort();
}
export function received<T>(
  tx: IDBTransaction,
  request: IDBRequest<T>,
  consume: (value: T) => void,
) {
  request.onsuccess = () => {
    try {
      consume(request.result);
    } catch (error) {
      abort(tx, error);
    }
  };
}
export function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(storageError(failures.get(tx) ?? tx.error));
    try {
      run(tx, (value) => {
        result = value;
      });
    } catch (error) {
      abort(tx, error);
    }
  });
}
