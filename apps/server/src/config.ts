import { ROOMS } from "@pl/shared";
import { isAddress, type Address } from "viem";

/** Default Generations deployment on Robinhood Chain (same values as the SDK's GENERATION_SPRITE_MANIFEST). */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const GENERATIONS_ADDRESS: Address = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";

/** Validated, immutable server configuration. Built only by {@link loadConfig} or tests. */
export interface ServerConfig {
  readonly env: "development" | "test" | "production";
  readonly host: string;
  readonly port: number;
  readonly logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  readonly databaseUrl: string;
  readonly dbPoolMax: number;
  /** Browser origins allowed to use the API (first one is canonical). SIWE domains are their hosts. */
  readonly publicOrigins: readonly string[];
  /** Shared secret the edge Worker sends as `x-pl-origin-key`. `null` disables the guard (dev/test only). */
  readonly originKey: string | null;
  /** Trust the Worker-supplied `x-pl-client-ip` on requests that passed the origin-key guard. */
  readonly trustEdgeClientIp: boolean;
  /** HS256 key for session and guest cookies (>= 32 bytes). */
  readonly sessionSecret: string;
  /** HMAC key for daily seeds (used by T7b). */
  readonly dailySecret: string;
  readonly cookieSecure: boolean;
  readonly sessionTtlSeconds: number;
  readonly guestTtlSeconds: number;
  readonly nonceTtlSeconds: number;
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly generationsAddress: Address;
  readonly economyMode: "sim" | "live";
  /** Room slugs the WebSocket layer accepts. */
  readonly rooms: readonly string[];
  /** Live mode only: `PixelLifeSink` address whose `Regrew`/`Mended` events credit pixels (contracts/README.md). */
  readonly pixelLifeSink: Address | null;
  /** Live mode only: confirmations a sink payment needs before it is credited. */
  readonly liveConfirmations: number;
  /** Seed Pack house stake the simulated ledger starts with (micro-RF; tokenomics §3: 10,000 RF). */
  readonly seedpackStakeMicro: number;
  /** Replay-verification worker threads (0 disables verification: runs stay `pending`). */
  readonly replayWorkers: number;
  /**
   * Guest-mode kill switch (D-15, `GUEST_MODE=on|off`, default on). Off: `POST /api/guest` answers 403
   * `guest_forbidden` and existing guest cookies stop counting as an identity for runs.
   */
  readonly guestMode: boolean;
}

/** One problem found while validating the environment. */
export interface ConfigIssue {
  readonly key: string;
  readonly message: string;
}

/** Thrown by {@link loadConfig} with every invalid variable listed, so a bad deploy fails once, clearly. */
export class ConfigError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`Invalid server configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const ROOM_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Parses and validates `process.env`-shaped input. Throws {@link ConfigError} listing all issues. */
export function loadConfig(env: Env): ServerConfig {
  const issues: ConfigIssue[] = [];
  const fail = (key: string, message: string) => issues.push({ key, message });
  const str = (key: string, fallback?: string): string => {
    const value = env[key]?.trim();
    if (value) return value;
    if (fallback !== undefined) return fallback;
    fail(key, "is required");
    return "";
  };
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(key, `must be an integer in [${min}, ${max}]`);
      return fallback;
    }
    return value;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    fail(key, "must be true/false");
    return fallback;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    if ((values as readonly string[]).includes(raw)) return raw as T;
    fail(key, `must be one of ${values.join(", ")}`);
    return fallback;
  };
  const secret = (key: string, required: boolean): string | null => {
    const value = env[key]?.trim();
    if (!value) {
      if (required) fail(key, "is required");
      return null;
    }
    if (Buffer.byteLength(value) < 32) fail(key, "must be at least 32 bytes (use `openssl rand -hex 32`)");
    return value;
  };

  const nodeEnv = oneOf("NODE_ENV", ["development", "test", "production"] as const, "development");
  const production = nodeEnv === "production";

  const publicOrigins = str("PUBLIC_ORIGINS", production ? undefined : "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of publicOrigins) {
    let url: URL | null = null;
    try {
      url = new URL(origin);
    } catch {
      fail("PUBLIC_ORIGINS", `${origin} is not a URL`);
    }
    if (url && url.origin !== origin) fail("PUBLIC_ORIGINS", `${origin} must be a bare origin like ${url.origin}`);
    if (url && production && url.protocol !== "https:") fail("PUBLIC_ORIGINS", `${origin} must be https in production`);
  }

  const databaseUrl = str("DATABASE_URL");
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) fail("DATABASE_URL", "must be a postgres:// URL");

  const rpcUrl = str("RPC_URL", ROBINHOOD_RPC_URL);
  if (!/^https?:\/\//.test(rpcUrl)) fail("RPC_URL", "must be an http(s) URL");

  const generationsAddress = str("GENERATIONS_ADDRESS", GENERATIONS_ADDRESS);
  if (!isAddress(generationsAddress, { strict: false })) fail("GENERATIONS_ADDRESS", "must be an address");

  const rooms = str("ROOMS", ROOMS.join(","))
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  for (const room of rooms) if (!ROOM_SLUG.test(room)) fail("ROOMS", `${room} is not a valid slug`);

  const economyMode = oneOf("ECONOMY_MODE", ["sim", "live"] as const, "sim");
  const sinkRaw = env["PIXEL_LIFE_SINK"]?.trim() ?? "";
  let pixelLifeSink: Address | null = null;
  if (sinkRaw) {
    if (isAddress(sinkRaw, { strict: false })) pixelLifeSink = sinkRaw.toLowerCase() as Address;
    else fail("PIXEL_LIFE_SINK", "must be an address");
  } else if (economyMode === "live") fail("PIXEL_LIFE_SINK", "is required when ECONOMY_MODE=live");

  const config: ServerConfig = {
    env: nodeEnv,
    host: str("HOST", "127.0.0.1"),
    port: int("PORT", 3100, 0, 65535),
    logLevel: oneOf("LOG_LEVEL", LOG_LEVELS, production ? "info" : "debug"),
    databaseUrl,
    dbPoolMax: int("DB_POOL_MAX", 10, 1, 100),
    publicOrigins,
    originKey: secret("ORIGIN_KEY", production),
    trustEdgeClientIp: bool("TRUST_EDGE_CLIENT_IP", true),
    sessionSecret: secret("SESSION_SECRET", true) ?? "",
    dailySecret: secret("DAILY_SECRET", true) ?? "",
    cookieSecure: bool("COOKIE_SECURE", true),
    sessionTtlSeconds: int("SESSION_TTL_DAYS", 7, 1, 90) * 86_400,
    guestTtlSeconds: int("GUEST_TTL_DAYS", 30, 1, 365) * 86_400,
    nonceTtlSeconds: 300,
    rpcUrl,
    chainId: int("CHAIN_ID", ROBINHOOD_CHAIN_ID, 1, 2 ** 31 - 1),
    generationsAddress: generationsAddress as Address,
    economyMode,
    rooms,
    pixelLifeSink,
    liveConfirmations: int("LIVE_CONFIRMATIONS", 3, 0, 1000),
    seedpackStakeMicro: int("SEEDPACK_STAKE_RF", 10_000, 0, 1_000_000_000) * 1_000_000,
    replayWorkers: int("REPLAY_WORKERS", 2, 0, 32),
    guestMode: oneOf("GUEST_MODE", ["on", "off"] as const, "on") === "on",
  };
  if (production && !config.cookieSecure) fail("COOKIE_SECURE", "must be true in production");
  if (issues.length > 0) throw new ConfigError(issues);
  return Object.freeze(config);
}

/** Hosts (with port) of the allowed public origins: the only accepted SIWE `domain` values. */
export function siweDomains(config: ServerConfig): readonly string[] {
  return config.publicOrigins.map((o) => new URL(o).host);
}
