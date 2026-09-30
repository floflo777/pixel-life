/**
 * CLI: `npm run bake:loaners -w @pl/assets [-- --rpc <url>] [--out <file>]`.
 *
 * Bakes the loaner roster from the live registry (or a mock RPC via `--rpc`, e.g. `@pl/mock-rpc`), verifies every
 * Friend against `docs/design/data/friends.json`, enforces the 60 KB budget and writes `tools/assets/out/loaners.json`.
 * Exits non-zero on any mismatch or budget overrun, leaving the previous file untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { redirectFetch } from "@pl/mock-rpc";
import { BAKE_SOURCE, bakeLoaners } from "./bake.js";
import {
  encodeLoaners,
  LOANERS,
  LOANERS_MAX_BYTES,
  stringifyLoaners,
  verifyAgainstDesign,
  type DesignFriendJson,
} from "./loaners.js";

const { values } = parseArgs({ options: { rpc: { type: "string" }, out: { type: "string" } } });
const out = values.out ?? fileURLToPath(new URL("../out/loaners.json", import.meta.url));
const design = JSON.parse(
  readFileSync(new URL("../../../docs/design/data/friends.json", import.meta.url), "utf8"),
) as DesignFriendJson[];

// The SDK reader hardcodes the public Robinhood RPC; `--rpc` reroutes its fetches (the mock speaks the same JSON-RPC).
const restore = values.rpc ? redirectFetch(values.rpc) : () => undefined;
try {
  const friends = await bakeLoaners(LOANERS);
  const report = verifyAgainstDesign(friends, design);
  const text = await stringifyLoaners(encodeLoaners(friends, BAKE_SOURCE));
  const bytes = Buffer.byteLength(text);
  console.log(`baked ${friends.length} loaners, ${bytes} bytes`);
  console.log(`verified vs friends.json: ${report.verified.join(", ") || "none"}`);
  if (report.unverified.length) console.log(`not in friends.json (unverified): ${report.unverified.join(", ")}`);
  if (report.mismatched.length) {
    console.error("MISMATCH vs friends.json:", JSON.stringify(report.mismatched));
    process.exitCode = 1;
  } else if (bytes > LOANERS_MAX_BYTES) {
    console.error(`loaners.json is ${bytes} bytes, over the ${LOANERS_MAX_BYTES} byte budget`);
    process.exitCode = 1;
  } else {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
} finally {
  restore();
}
