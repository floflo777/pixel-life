import { createReadStream, existsSync, statSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "../..");
/** `friendsdk build` output of the stock Seed Pack venue (apps/seed-pack). */
const seedPackOut = path.resolve(repoRoot, "apps/seed-pack/.friendsdk");
/** Only the sandboxed child document and its files are served: the SDK's standalone index.html is not. */
const CHILD_FILES = /^(game\.html|game\.js|game\.css|game-layout\.css|assets\/[\w.-]+\.woff2)$/;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};
/** The SDK child CSP (FriendSDK 0.1.4 `childCsp`), mirrored as a header in dev like the edge Worker does. */
const CHILD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
  "font-src 'self'; media-src 'self' blob:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'self'";

/**
 * Serves `/venues/seed-pack/*` from the SDK build in dev and copies it into `dist/venues/seed-pack/` on build, so the
 * stock child document is same-origin with the shell (architecture §1.2). Run `npm run build -w @pl/seed-pack` first.
 */
function seedPackVenue(): Plugin {
  return {
    name: "pl-seed-pack-venue",
    configureServer(server) {
      server.middlewares.use("/venues/seed-pack", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/").replace(/^\/+/, "");
        if (!CHILD_FILES.test(rel)) return next();
        const file = path.join(seedPackOut, rel);
        if (!existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end("Seed Pack venue not built: npm run build -w @pl/seed-pack");
          return;
        }
        res.setHeader("content-type", MIME[path.extname(file)] ?? "application/octet-stream");
        if (rel === "game.html") res.setHeader("content-security-policy", CHILD_CSP);
        createReadStream(file).pipe(res);
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ?? path.resolve(here, "dist");
      if (!existsSync(path.join(seedPackOut, "game.html"))) {
        this.warn("apps/seed-pack/.friendsdk is missing: the Seed Pack booth will 404 (npm run build:all).");
        return;
      }
      const target = path.join(outDir, "venues/seed-pack");
      await mkdir(target, { recursive: true });
      await cp(seedPackOut, target, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(seedPackOut, src).split(path.sep).join("/");
          return rel === "" || rel === "assets" || CHILD_FILES.test(rel);
        },
      });
    },
  };
}

const api = process.env.PL_API_URL ?? "http://127.0.0.1:3100";

/** Vite + React shell. `/api` and `/ws` proxy to apps/server in dev (same-origin, like the edge Worker in prod). */
export default defineConfig({
  plugins: [react(), seedPackVenue()],
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/ws": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    manifest: true,
    // three.js alone is ~150 KB gz; the landing budget is checked by scripts/size.mjs instead.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      // @pl/assets lazily imports prettier only to *write* loaners.json at bake time; never ship it.
      external: [/^prettier(\/.*)?$/],
    },
  },
});
