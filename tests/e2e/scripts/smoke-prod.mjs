#!/usr/bin/env node
/**
 * `npm run smoke:prod -w @pl/e2e [-- <extra playwright args>]`: the read-only specs (guest, hub, economy pages, smoke)
 * against a deployed build. No local stack is started, no wallet is connected, nothing is bought.
 * Target: PL_WEB_URL, default the staging Worker.
 */
import { spawnSync } from "node:child_process";

const DEFAULT_URL = "https://loose-pixels.florent-g.workers.dev";
const url = process.env.PL_WEB_URL || DEFAULT_URL;
const args = [
  "playwright",
  "test",
  "--project=desktop-chromium",
  "--project=mobile-pixel7",
  // One browser at a time: the deployed server rate-limits guests and WebSocket joins per IP.
  "--workers=1",
  "specs/smoke.spec.ts",
  "specs/web-guest.spec.ts",
  "specs/hub.spec.ts",
  "specs/economy-pages.spec.ts",
  "specs/onboarding.spec.ts",
  ...process.argv.slice(2),
];
console.log(`smoke:prod → ${url}`);
const result = spawnSync("npx", args, { stdio: "inherit", env: { ...process.env, PL_WEB_URL: url } });
process.exit(result.status ?? 1);
