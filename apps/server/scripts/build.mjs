// Bundles the server for production: our TypeScript (including @pl/* workspace sources) into dist/*.mjs,
// every npm package left external and installed in the runtime image.
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Bare imports stay external except our workspace packages, which ship as TypeScript source. */
const externalizeNpm = {
  name: "externalize-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@pl/") || args.path.startsWith("node:") ? undefined : { path: args.path, external: true },
    );
  },
};

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: root,
  // The replay worker is its own entry: worker_threads load it by URL next to main.mjs (src/runs/verifier.ts).
  entryPoints: { main: "src/main.ts", migrate: "src/cli/migrate.ts", "replay-worker": "src/runs/replay-worker.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  plugins: [externalizeNpm],
});
