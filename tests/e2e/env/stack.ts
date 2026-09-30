/**
 * The local e2e stack (ports, URLs and test secrets), shared by `playwright.config.ts`, the launchers in `env/` and the
 * fixtures. Ports sit away from the dev defaults (5173 / 3100 / 8545) so a running dev stack never collides with e2e.
 */
import { tmpdir } from "node:os";

const port = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) throw new Error(`${name} must be a TCP port`);
  return value;
};

/** Web app (vite preview of the production build); proxies /api and /ws to the server. */
export const WEB_PORT = port("E2E_WEB_PORT", 14_173);
/** The API as the web app's proxy sees it: the edge stand-in (env/edge.ts) in front of apps/server. */
export const API_PORT = port("E2E_API_PORT", 13_100);
/** apps/server itself (only the edge stand-in talks to it). */
export const SERVER_PORT = port("E2E_SERVER_PORT", 13_101);
/** The shared mock Robinhood Chain (`@pl/mock-rpc --admin`), read by the server and every browser. */
export const RPC_PORT = port("E2E_RPC_PORT", 18_545);

export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const SHARED_RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

/**
 * Deployed app under test (`PL_WEB_URL`, e.g. `npm run smoke:prod`). When set, no local stack is started and the suite
 * is read-only: specs that need the shared mock chain or a wallet write skip themselves.
 */
export const REMOTE_URL = process.env["PL_WEB_URL"] ?? null;

/** Throwaway secrets for the e2e server (>= 32 bytes, as `loadConfig` requires). Never used outside e2e. */
export const TEST_SECRETS = Object.freeze({
  SESSION_SECRET: "e2e-session-secret-e2e-session-secret-0001",
  DAILY_SECRET: "e2e-daily-secret-e2e-daily-secret-e2e-00001",
  ORIGIN_KEY: "e2e-origin-key-e2e-origin-key-e2e-origin-01",
});

/**
 * Where the server launcher records the stack's database URL, so fixtures can seed test data the UI cannot create
 * quickly (e.g. a Friend's past runs). Keyed by the API port: one file per local stack.
 */
export const STACK_STATE_FILE = `${tmpdir()}/pl-e2e-stack-${API_PORT}.json`;

/** Contents of {@link STACK_STATE_FILE}. */
export interface StackState {
  readonly databaseUrl: string;
}
