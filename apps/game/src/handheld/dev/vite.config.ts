import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Dev playground for the handheld mode (device frame + test host). */
export default defineConfig({
  root: here,
  server: { port: 5178, strictPort: false, fs: { allow: [repoRoot] } },
});
