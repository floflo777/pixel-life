import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, siweDomains } from "./config.js";

const base = {
  DATABASE_URL: "postgres://pl:pw@127.0.0.1:55432/pixel_life",
  SESSION_SECRET: "s".repeat(32),
  DAILY_SECRET: "d".repeat(32),
};

describe("loadConfig", () => {
  it("applies safe defaults for development", () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      env: "development",
      host: "127.0.0.1",
      port: 3100,
      originKey: null,
      cookieSecure: true,
      chainId: 4663,
      economyMode: "sim",
      sessionTtlSeconds: 7 * 86_400,
      guestTtlSeconds: 30 * 86_400,
      rooms: ["plaza", "pixel-arena", "seed-booth", "sky-docks", "daily-gate"],
    });
    expect(siweDomains(config)).toEqual(["localhost:5173"]);
  });

  it("requires the origin key and https origins in production, and lists every problem at once", () => {
    let error: unknown;
    try {
      loadConfig({
        ...base,
        NODE_ENV: "production",
        PUBLIC_ORIGINS: "http://pixel-life.example.workers.dev",
        SESSION_SECRET: "short",
        PORT: "99999",
        COOKIE_SECURE: "false",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const keys = (error as ConfigError).issues.map((i) => i.key).sort();
    expect(keys).toEqual(["COOKIE_SECURE", "ORIGIN_KEY", "PORT", "PUBLIC_ORIGINS", "SESSION_SECRET"]);
  });

  it("accepts a complete production environment", () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: "production",
      PUBLIC_ORIGINS: "https://pixel-life.florent-g.workers.dev, https://pixel-life.floflo777.workers.dev",
      ORIGIN_KEY: "k".repeat(64),
      HOST: "0.0.0.0",
    });
    expect(siweDomains(config)).toEqual(["pixel-life.florent-g.workers.dev", "pixel-life.floflo777.workers.dev"]);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(() => loadConfig({ ...base, PUBLIC_ORIGINS: "https://a.example/path" })).toThrow(/bare origin/);
    expect(() => loadConfig({ ...base, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
    expect(() => loadConfig({ ...base, ROOMS: "Plaza!" })).toThrow(/ROOMS/);
    expect(() => loadConfig({ ...base, ECONOMY_MODE: "real" })).toThrow(/ECONOMY_MODE/);
  });
});
