import type { FriendAppearance, FriendPublic } from "@pl/shared";
import { describe, expect, it, vi } from "vitest";
import { ownedView } from "../test/fixtures.js";
import { createFriendSource, PUBLIC_TTL_MS, toFlingBelt } from "./friend-source.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("hub friend source", () => {
  const other = ownedView("65058");
  const you = ownedView("344030");
  const api = () => ({
    appearance: vi.fn(async (id: string): Promise<FriendAppearance> => ({ ...other.appearance, tokenId: id })),
    publicFriend: vi.fn(async (id: string): Promise<FriendPublic> => ({ ...other.pub, tokenId: id })),
  });

  it("caches appearances forever and shares concurrent fetches", async () => {
    const a = api();
    const src = createFriendSource({ api: a });
    const [x, y] = await Promise.all([src.appearance("1"), src.appearance("1")]);
    expect(x).toBe(y);
    await src.appearance("1");
    expect(a.appearance).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed appearance", async () => {
    const a = api();
    a.appearance.mockRejectedValueOnce(new Error("offline"));
    const src = createFriendSource({ api: a });
    await expect(src.appearance("1")).rejects.toThrow("offline");
    await flush();
    await expect(src.appearance("1")).resolves.toMatchObject({ tokenId: "1" });
  });

  it("caches public state for 15 s unless asked for a fresh copy", async () => {
    let now = 0;
    const a = api();
    const src = createFriendSource({ api: a, now: () => now });
    await src.publicState("1");
    await src.publicState("1");
    expect(a.publicFriend).toHaveBeenCalledTimes(1);
    await src.publicState("1", true);
    expect(a.publicFriend).toHaveBeenCalledTimes(2);
    now += PUBLIC_TTL_MS;
    await src.publicState("1");
    expect(a.publicFriend).toHaveBeenCalledTimes(3);
  });

  it("serves your own Friend (and loaners' art) locally", async () => {
    const a = api();
    const src = createFriendSource({
      api: a,
      local: () => [{ appearance: you.appearance, pub: you.pub }, { appearance: other.appearance }],
    });
    expect(await src.appearance("344030")).toBe(you.appearance);
    expect(await src.publicState("344030", true)).toBe(you.pub);
    expect(await src.appearance("65058")).toBe(other.appearance);
    await src.publicState("65058");
    expect(a.appearance).not.toHaveBeenCalled();
    expect(a.publicFriend).toHaveBeenCalledTimes(1);
  });

  it("prefetches belts with the appearance for the synchronous beltOf", async () => {
    const belt = vi.fn(async (id: string) => (id === "1" ? "gulp_master" : null));
    const src = createFriendSource({ api: api(), belt });
    expect(src.beltOf("1")).toBeNull();
    await src.appearance("1");
    await src.appearance("2");
    await flush();
    expect(src.beltOf("1")).toBe("gulp-master");
    expect(src.beltOf("2")).toBeNull();
    expect(belt).toHaveBeenCalledTimes(2);
  });

  it("maps meta belt ids onto hub belts", () => {
    expect(toFlingBelt("black")).toBe("black");
    expect(toFlingBelt("gulp_master")).toBe("gulp-master");
    expect(toFlingBelt("plaid")).toBeNull();
    expect(toFlingBelt(null)).toBeNull();
  });
});
