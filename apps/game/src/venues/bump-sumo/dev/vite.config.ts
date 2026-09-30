import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

/** Bump Sumo venue dev page: `npx vite --config apps/game/src/venues/bump-sumo/dev/vite.config.ts`. */
export default defineConfig({
  root: here,
  server: { port: 5177, strictPort: false, fs: { allow: [repoRoot] } },
  preview: { port: 5177 },
});
