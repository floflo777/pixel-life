import { describe, expect, it } from "vitest";
import { EMPTY_MASK, ROOMS, fromRows, type ServerMsg } from "@pl/shared";
import { HUB_NAVMESHES, Navmesh, centroid } from "@pl/realtime";
import { toWorld } from "./coords";
import { spritePixels } from "./impostors";
import type { HubSession } from "@pl/realtime";
import type { ClientSocket } from "@pl/realtime/client";
import { createLocalHub, createLocalHubNet, hubNetFromClient, LocalSocket } from "./net";
import { coveringSeed, optionalVenues, roomLayout, roomZones } from "./rooms";
import { islandCells } from "../world/island";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("local HubNet", () => {
  it("joins, receives welcome, and sees other Friends' moves and emotes", async () => {
    const hub = createLocalHub();
    const a = createLocalHubNet(hub, {
      identityKey: "a",
      owner: null,
      profile: { kind: "guest", tokenId: "1", loaned: true, scarsHash: "h", goldHeld: 0 },
    });
    const b = createLocalHubNet(hub, {
      identityKey: "b",
      owner: null,
      profile: { kind: "owner", tokenId: "2", loaned: false, scarsHash: "h", goldHeld: 0 },
    });
    const got: ServerMsg[] = [];
    a.on((m) => got.push(m));
    expect(a.state()).toBe("idle");
    await a.connect("plaza");
    expect(a.state()).toBe("open");
    await b.connect("plaza");
    b.send(["move", 1, 0, 1500]);
    b.send(["emote", 3]);
    await flush();
    const types = got.map((m) => m[0]);
    expect(types).toEqual(expect.arrayContaining(["welcome", "join", "moved", "emote"]));
    // Switching room leaves the old shard.
    await b.connect("sky-docks", "plaza");
    await flush();
    expect(got.map((m) => m[0])).toContain("leave");
    a.close();
    b.close();
    expect(a.state()).toBe("closed");
  });
});

describe("HubClient HubNet adapter", () => {
  it("builds the room URL, resolves on welcome and relays every server message", async () => {
    const hub = createLocalHub();
    const urls: string[] = [];
    /** A browser-socket stand-in wired straight into the in-memory hub. */
    class BridgeSocket implements ClientSocket {
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      #session: HubSession | null = null;
      constructor(url: string) {
        urls.push(url);
        const room = /room\/([a-z-]+)/.exec(url)?.[1] ?? "plaza";
        const s = new LocalSocket();
        s.onFrame = (data) => this.onmessage?.({ data } as MessageEvent);
        s.onClose = (code) => this.onclose?.({ code } as CloseEvent);
        queueMicrotask(() => {
          this.readyState = 1;
          const r = hub.join(s, {
            identityKey: "c",
            owner: null,
            room,
            profile: { kind: "guest", tokenId: "7", loaned: true, scarsHash: "h", goldHeld: 0 },
          });
          if (r.ok) this.#session = r.session;
        });
      }
      send(data: string): void {
        this.#session?.receive(data);
      }
      close(): void {
        this.readyState = 3;
        this.#session?.leave();
      }
    }
    const net = hubNetFromClient({
      url: (room, from) => `/ws/room/${room}${from ? `?from=${from}` : ""}`,
      WebSocket: BridgeSocket,
    });
    const got: string[] = [];
    net.on((m) => got.push(m[0]));
    await net.connect("sky-docks", "plaza");
    expect(urls).toEqual(["/ws/room/sky-docks?from=plaza"]);
    expect(net.state()).toBe("open");
    expect(got).toContain("welcome");
    net.send(["emote", 1]);
    await flush();
    expect(got).toContain("emote");
    expect(Math.abs(net.serverNow() - Date.now())).toBeLessThan(1000);
    net.close();
    expect(net.state()).toBe("idle");
  });
});

describe("room layouts", () => {
  it("cover every walkable point that must stand on land, for every room", () => {
    for (const slug of ROOMS) {
      const L = roomLayout(slug);
      const seed = coveringSeed(L.island, L.island.seed, L.cover);
      const cells = islandCells({
        radius: L.island.radius,
        seed,
        ...(L.island.squash !== undefined ? { squash: L.island.squash } : {}),
      });
      const missing = L.cover.filter((p) => !cells.has(`${Math.round(p.x / 0.24)},${Math.round(p.z / 0.24)}`));
      expect(missing, slug).toEqual([]);
    }
  });
  it("expose every navmesh door plus walkable client venue doormats", () => {
    for (const slug of ROOMS) {
      const nm = new Navmesh(HUB_NAVMESHES[slug]);
      const zones = roomZones(slug);
      for (const d of HUB_NAVMESHES[slug].doors) expect(zones.some((z) => z.id === d.id)).toBe(true);
      for (const z of zones) {
        expect(nm.contains(centroid(z.area)), `${slug}:${z.id}`).toBe(true);
        expect(nm.contains(z.spawn), `${slug}:${z.id} spawn`).toBe(true);
      }
    }
    const plazaVenue = roomZones("plaza").find((z) => z.kind === "venue");
    expect(plazaVenue?.target).toBe("pixel-life");
    // The doormat sits in front of the hall, at the north rim of the plaza.
    expect(toWorld(...centroid(plazaVenue?.area ?? [])).z).toBeLessThan(-7);
  });
  it("build optional venue halls only for enabled venues; page doors always exist", () => {
    const all = ROOMS.flatMap((slug) => roomZones(slug).map((z) => z.target));
    for (const id of ["greenhouse", "daily-stone", "mend-board", "handheld", "bump-sumo", "pixel-putt"])
      expect(all).toContain(id);
    const none = ROOMS.flatMap((slug) => roomZones(slug, new Set()).map((z) => z.target));
    for (const id of ["greenhouse", "daily-stone", "mend-board", "pixel-life", "seed-pack"]) expect(none).toContain(id);
    for (const id of ["handheld", "bump-sumo", "pixel-putt"]) expect(none).not.toContain(id);
    expect(optionalVenues("pixel-arena")).toEqual(["bump-sumo", "pixel-putt"]);
    const sumoOnly = roomZones("pixel-arena", new Set(["bump-sumo"])).map((z) => z.target);
    expect(sumoOnly).toContain("bump-sumo");
    expect(sumoOnly).not.toContain("pixel-putt");
  });
});

describe("impostor pixels", () => {
  it("decodes a frame, marks scars and finds the feet anchor", () => {
    const rows = Array.from({ length: 16 }, (_, r) => (r >= 10 && r <= 13 ? "......####......" : "................"));
    const frame = fromRows(rows);
    const lost = fromRows(rows.map((row, r) => (r === 13 ? row : "................")));
    const px = spritePixels(frame, lost);
    expect(px.count).toBe(16);
    expect(px.bottom).toBe(13);
    expect(px.cx).toBeCloseTo(7.5);
    expect(px.height).toBe(4);
    let scars = 0;
    for (let k = 0; k < px.count; k++) scars += px.cells[k * 3 + 2] ?? 0;
    expect(scars).toBe(4);
    expect(spritePixels(frame, lost)).toBe(px); // cached
    expect(spritePixels(EMPTY_MASK, EMPTY_MASK).count).toBe(0);
  });
});
