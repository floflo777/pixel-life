import { describe, expect, it } from "vitest";
import { venueIds } from "../venues/registry.js";
import { doorAction, friendHref, homeHref, lastRoom, mendHref, playHref, rememberRoom } from "./doors.js";

describe("hub doors", () => {
  it("page doors open their page straight away", () => {
    expect(doorAction("greenhouse", null)).toEqual({ kind: "page", title: "Greenhouse", href: "/regrow" });
    expect(doorAction("daily-stone", null)).toMatchObject({ kind: "page", href: "/board" });
    expect(doorAction("mend-board", null)).toMatchObject({ kind: "page", href: "/mend" });
  });

  it("venue doors show the venue card with the registry's name, rule and route", () => {
    expect(doorAction("pixel-life", null)).toMatchObject({
      kind: "venue",
      name: "Loose Pixels",
      mode: "quick",
      href: "/play",
    });
    expect(doorAction("pixel-life", "daily")).toMatchObject({
      name: "Loose Pixels · Daily",
      mode: "daily",
      href: "/play?mode=daily",
    });
    expect(doorAction("seed-pack", null)).toMatchObject({ kind: "venue", href: "/venue/seed-pack" });
    expect(doorAction("handheld", null)).toMatchObject({ kind: "venue", href: "/play?venue=handheld" });
    expect(doorAction("moon-base", null)).toEqual({ kind: "none" });
  });

  it("every registered venue has a door action", () => {
    for (const id of venueIds()) expect(doorAction(id, null).kind).toBe("venue");
  });

  it("builds play, mend, friend and home routes", () => {
    expect(playHref("pixel-life", "quick")).toBe("/play");
    expect(playHref("bump-sumo", "daily")).toBe("/play?venue=bump-sumo&mode=daily");
    expect(mendHref("344030")).toBe("/f/344030?action=mend");
    expect(friendHref("7")).toBe("/f/7");
    expect(homeHref("7")).toBe("/sky?home=7");
  });

  it("remembers the room to come back to, defaulting to the plaza", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(lastRoom(storage)).toBe("plaza");
    rememberRoom("seed-booth", storage);
    expect(lastRoom(storage)).toBe("seed-booth");
    store.set("pl.sky.room", "atlantis");
    expect(lastRoom(storage)).toBe("plaza");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(lastRoom(broken)).toBe("plaza");
    expect(() => rememberRoom("plaza", broken)).not.toThrow();
  });
});
