import { defineConfig } from "@playwright/test";
export default defineConfig({
  expect: { timeout: 15000 },
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "off", screenshot: "off" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
      MEDIA_ROOT: process.env.MEDIA_ROOT!,
    },
  },
});
