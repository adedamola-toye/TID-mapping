import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`npm run build` first) on port 3100 with a
 * dedicated, freshly seeded database (E2E_DATABASE_URL, default wakeel_e2e).
 */
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://wakeel:wakeel_dev_pw@localhost:5432/wakeel_e2e";
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      NODE_ENV: "production",
      SECURE_COOKIES: "false",
      EMAIL_TRANSPORT: "none",
    },
  },
});
