import { defineConfig } from "@playwright/test";

/** Test end-to-end contro lo stack di verifica locale (scripts/verify-stack). L'app deve essere già avviata su :3100. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "only-on-failure",
    locale: "it-IT",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  outputDir: "test-results",
});
