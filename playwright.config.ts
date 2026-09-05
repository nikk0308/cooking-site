import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health/live",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: "postgresql://unused:unused@127.0.0.1:9/unused" },
  },
});
