import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * The web app URL. Set PL_WEB_URL to test a running app (e.g. staging); otherwise, once apps/web
 * has an index.html, Playwright starts its Vite dev server itself.
 */
const webUrl = process.env.PL_WEB_URL ?? "http://127.0.0.1:5173";
const startWeb = !process.env.PL_WEB_URL && existsSync(new URL("../../apps/web/index.html", import.meta.url));

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-pixel7", use: { ...devices["Pixel 7"] } },
    { name: "mobile-iphone13", use: { ...devices["iPhone 13"] } },
  ],
  ...(startWeb
    ? {
        webServer: {
          command: "npm run dev -w @pl/web -- --host 127.0.0.1 --port 5173 --strictPort",
          cwd: "../..",
          url: webUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});
