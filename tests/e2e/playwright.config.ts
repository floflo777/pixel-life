import { existsSync } from "node:fs";
import { defineConfig, devices, webkit, type PlaywrightTestConfig } from "@playwright/test";
import { API_PORT, API_URL, REMOTE_URL, RPC_PORT, SHARED_RPC_URL, WEB_PORT, WEB_URL } from "./env/stack.js";

/**
 * Two modes:
 *  - local stack (default): Playwright starts the shared mock chain, apps/server (fresh Postgres, migrations, test
 *    secrets, RPC → mock) and a `vite preview` of the production web build proxying /api and /ws to the server;
 *  - remote (`PL_WEB_URL=https://…`, `npm run smoke:prod`): nothing is started and only read-only specs run.
 */
const ci = !!process.env["CI"];
const baseURL = REMOTE_URL ?? WEB_URL;
/**
 * WebKit (iPhone 13) runs in CI, which installs it with its system libraries. Locally it is opt-in (E2E_WEBKIT=1)
 * because the binary alone does not launch without them (`sudo npx playwright install-deps webkit`).
 */
const hasWebKit = existsSync(webkit.executablePath()) && (ci || process.env["E2E_WEBKIT"] === "1");

const webServer: PlaywrightTestConfig["webServer"] = REMOTE_URL
  ? undefined
  : [
      {
        name: "mock-rpc",
        command: `npm start -w @pl/mock-rpc -- --port ${RPC_PORT} --admin`,
        cwd: "../..",
        url: SHARED_RPC_URL,
        reuseExistingServer: !ci,
        timeout: 30_000,
        stdout: "ignore",
      },
      {
        name: "server",
        command: "node --import tsx env/server.ts",
        url: `${API_URL}/readyz`,
        reuseExistingServer: !ci,
        timeout: 120_000,
        stdout: "pipe",
        gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
      },
      {
        name: "web",
        command:
          (process.env["E2E_SKIP_BUILD"] ? "" : "npm run build:all -w @pl/web && ") +
          `npm run preview -w @pl/web -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
        cwd: "../..",
        url: WEB_URL,
        env: { PL_API_URL: API_URL },
        reuseExistingServer: !ci,
        timeout: 180_000,
      },
    ];

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  ...(ci ? { workers: 2 } : {}),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  metadata: { apiPort: API_PORT },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // WebGL through SwiftShader: the stage, the hub and the venues render in headless CI too.
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-pixel7", use: { ...devices["Pixel 7"] } },
    ...(hasWebKit
      ? [
          {
            name: "mobile-iphone13",
            use: { ...devices["iPhone 13"], launchOptions: {} },
            // Only the guest and read-only specs: the full wallet flows are covered by the Chromium projects.
            testMatch: /(web-guest|smoke|economy-pages)\.spec\.ts$/,
          },
        ]
      : []),
  ],
  ...(webServer ? { webServer } : {}),
});
