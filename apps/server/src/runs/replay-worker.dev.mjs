// Dev/test bootstrap for the replay worker thread: registers tsx in this thread, then loads the TypeScript entry.
// Production runs the esbuild bundle `dist/replay-worker.mjs` instead (see verifier.ts).
import { register } from "tsx/esm/api";

register();
await import("./replay-worker.ts");
