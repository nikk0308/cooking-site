import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testDir: "./tests/release-e2e",
  reporter: "line",
  use: {
    ...base.use,
    // Credentialed admin tracing stays off. The journey records anonymous
    // visitor traces explicitly and retains them only on failure.
    trace: "off",
    screenshot: "only-on-failure",
  },
});
