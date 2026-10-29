import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { writeFile, unlink } from "node:fs/promises";
import { test } from "./playwright";

export function releaseDiagnostics(info: TestInfo) {
  const events: { kind: string; page: string; detail: string }[] = [];
  const contexts: { label: string; context: BrowserContext }[] = [];
  const pages: { label: string; page: Page }[] = [];
  const files: string[] = [];
  const cleanupFailures: string[] = [];
  let lastCompleted = "none",
    current = "none",
    firstIncomplete: string | null = null;
  const safeUrl = (raw: string) => {
    try {
      return new URL(raw).pathname
        .replace(/[a-f0-9-]{36}/gi, ":id")
        .slice(0, 140);
    } catch {
      return "non-http-resource";
    }
  };
  const save = () =>
    writeFile(
      info.outputPath("release-diagnostics.json"),
      JSON.stringify(
        {
          lastCompleted,
          current,
          firstIncomplete,
          cleanupFailures,
          events,
          privacy:
            "No headers, bodies, credentialed traces or real profiles recorded",
        },
        null,
        2,
      ),
    );
  const record = (kind: string, page: string, detail: string) => {
    if (events.length < 100) events.push({ kind, page, detail });
  };
  function watch(label: string, page: Page) {
    pages.push({ label, page });
    page.on("console", (message) => {
      if (message.type() === "error")
        record(
          "console-error",
          label,
          /hydrat/i.test(message.text())
            ? "hydration-error"
            : "console-error; text omitted; see anonymous trace",
        );
    });
    page.on("pageerror", (error) =>
      record("page-error", label, error.name.slice(0, 80)),
    );
    page.on("requestfailed", (request) =>
      record(
        "request-failed",
        label,
        `${request.method()} ${safeUrl(request.url())}`,
      ),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        record(
          "http-error",
          label,
          `${response.status()} ${safeUrl(response.url())}`,
        );
    });
  }
  return {
    watch,
    async anonymousContext(label: string, context: BrowserContext) {
      // Admin context is deliberately never traced: Playwright traces contain
      // login values, request bodies and session cookies even with sources off.
      if (
        (await context.cookies()).some(
          (cookie) => cookie.name === "recipes-admin",
        )
      )
        throw new Error("Refusing to trace a credentialed browser context");
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
      contexts.push({ label, context });
    },
    async step<T>(
      name: string,
      action: () => Promise<T>,
      timeout?: number,
    ): Promise<T> {
      current = name;
      await save();
      console.log(`[release-step] BEGIN ${name}`);
      try {
        const result = await test.step(name, action, { timeout });
        if (!name.startsWith("13")) lastCompleted = name;
        console.log(`[release-step] PASS ${name}`);
        return result;
      } catch (error) {
        if (name.startsWith("13")) cleanupFailures.push(name);
        else firstIncomplete ??= name;
        console.log(`[release-step] FAIL ${name}`);
        throw error;
      } finally {
        await save();
      }
    },
    async preserveBeforeClose() {
      // Stop before profile cleanup so even a stuck close has an existing trace.
      for (const { label, context } of contexts) {
        const file = info.outputPath(`release-${label}-trace.zip`);
        try {
          await context.tracing.stop({ path: file });
          files.push(file);
        } catch {
          record("trace-unavailable", label, "context already unavailable");
        }
      }
      for (const { label, page } of pages) {
        if (page.isClosed()) continue;
        const file = info.outputPath(`release-${label}.png`);
        try {
          await page.screenshot({
            path: file,
            mask: [page.locator("input,textarea")],
            timeout: 5000,
          });
          files.push(file);
        } catch {
          record("screenshot-unavailable", label, "page unavailable");
        }
      }
      await save();
    },
    async finish(failed: boolean) {
      await save();
      if (!failed) for (const file of files) await unlink(file);
    },
  };
}
