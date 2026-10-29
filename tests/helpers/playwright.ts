import {
  test as base,
  expect,
  type Browser,
  type BrowserContextOptions,
  webkit,
} from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// WebKit deliberately rejects IndexedDB Blobs in ephemeral/private sessions.
// Exercise normal browser storage with a real, disposable disk profile instead.
// Chromium/Firefox retain the standard isolated contexts. No real profile is used.
export async function browserProfile(
  browser: Browser,
  options: BrowserContextOptions = {},
) {
  if (browser.browserType().name() !== "webkit")
    return browser.newContext(options);
  const root = await mkdtemp(
    path.join(os.tmpdir(), "culinote-webkit-profile-"),
  );
  const cleanup = async () => {
    const resolved = await realpath(root);
    if (
      path.dirname(resolved) !== (await realpath(os.tmpdir())) ||
      !path.basename(resolved).startsWith("culinote-webkit-profile-")
    )
      throw new Error("Unsafe isolated browser profile cleanup");
    await rm(resolved, { recursive: true, force: true });
  };
  try {
    const context = await webkit.launchPersistentContext(root, options);
    const close = context.close.bind(context);
    let closed = false;
    context.close = async (opts) => {
      if (closed) return;
      closed = true;
      try {
        await close(opts);
      } finally {
        await cleanup();
      }
    };
    return context;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
export const test = base.extend({
  context: async (
    { context, browser, browserName, contextOptions, baseURL },
    provide,
  ) => {
    if (browserName !== "webkit") return provide(context);
    const profile = await browserProfile(browser, {
      ...contextOptions,
      baseURL,
    });
    try {
      await provide(profile);
    } finally {
      await profile.close();
    }
  },
});
export { expect };
export type { Page, BrowserContext } from "@playwright/test";
