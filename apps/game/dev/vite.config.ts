import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Dev playground for visual checks of the stage, post pipeline and world kit. */
export default defineConfig({
  root: here,
  server: { port: 5174, strictPort: false, fs: { allow: [repoRoot] } },
  preview: { port: 5174 },
});
