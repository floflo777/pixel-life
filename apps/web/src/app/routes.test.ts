import { describe, expect, it } from "vitest";
import { buildPath, matchPath } from "../lib/router.js";
import { href, loaderOf, resolveRoute, ROUTES } from "./routes.js";

describe("router", () => {
  it("matches patterns with params and ignores trailing slashes", () => {
    expect(matchPath("/f/:tokenId", "/f/344030")).toEqual({ tokenId: "344030" });
    expect(matchPath("/f/:tokenId", "/f/344030/")).toEqual({ tokenId: "344030" });
    expect(matchPath("/f/:tokenId", "/f")).toBeNull();
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/sky", "/skyx")).toBeNull();
    expect(buildPath("/venue/:id", { id: "seed-pack" })).toBe("/venue/seed-pack");
  });

  it("resolves every GDD route and builds hrefs", () => {
    expect(resolveRoute("/")?.route.name).toBe("landing");
    expect(resolveRoute("/play")?.route.name).toBe("play");
    expect(resolveRoute("/f/7")).toMatchObject({ route: { name: "friend" }, params: { tokenId: "7" } });
    expect(resolveRoute("/venue/seed-pack")?.params).toEqual({ id: "seed-pack" });
    expect(resolveRoute("/nope")).toBeNull();
    expect(href("friend", { tokenId: "7" })).toBe("/f/7");
    expect(href("play", {}, { mode: "daily" })).toBe("/play?mode=daily");
    expect(() => href("missing")).toThrow();
  });

  it("has unique names and paths; shell routes always load, pages routes may be pending", () => {
    expect(new Set(ROUTES.map((r) => r.name)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
    for (const r of ROUTES) {
      if (r.owner === "shell") expect(loaderOf(r)).toBeTypeOf("function");
      else expect(r.page).toMatch(/^[A-Z]\w+Page$/);
    }
  });
});
