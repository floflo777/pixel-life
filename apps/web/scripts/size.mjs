#!/usr/bin/env node
/**
 * Size budget (architecture §3 / §5): JavaScript needed from the landing page to guest play must stay ≤ 350 KB gzip.
 * Walks the Vite manifest from the entry plus the modules the guest path loads on demand (landing, play screen, stage
 * runtime, placeholder venue, loaners, audio), following static imports, and sums the gzip size of each JS chunk once.
 * Run after `vite build`.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const manifest = JSON.parse(readFileSync(path.join(dist, ".vite/manifest.json"), "utf8"));
const BUDGET = 350 * 1024;
const GUEST_PATH = [
  "index.html",
  "src/shell/Landing.tsx",
  "src/stage/runtime.ts",
  "src/venues/PlayScreen.tsx",
  "src/venues/placeholder-venue.ts",
  "../../tools/assets/src/index.ts",
  "../../tools/assets/out/loaners.json",
  "../../packages/audio/src/index.ts",
];

const seen = new Set();
const files = new Map();
const visit = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`size: ${key} is not in the manifest (renamed? update GUEST_PATH)`);
  if (entry.file.endsWith(".js")) files.set(entry.file, gzipSync(readFileSync(path.join(dist, entry.file))).length);
  for (const imp of entry.imports ?? []) visit(imp);
};
GUEST_PATH.forEach(visit);

const total = [...files.values()].reduce((a, b) => a + b, 0);
for (const [f, n] of [...files].sort((a, b) => b[1] - a[1]))
  console.log(`${(n / 1024).toFixed(1).padStart(7)} KB  ${f}`);
console.log(`landing → guest play: ${(total / 1024).toFixed(1)} KB gzip (budget ${BUDGET / 1024} KB)`);
if (total > BUDGET) {
  console.error("over budget");
  process.exit(1);
}
