import { defineConfig } from "vite";

/** Dev-only audition page: `npm run dev -w @pl/audio`. Not part of any shipped bundle. */
export default defineConfig({ root: "dev", server: { port: 5178 } });
