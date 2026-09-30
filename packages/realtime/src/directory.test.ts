import { describe, expect, it } from "vitest";
import { Directory, parseShardParam, shardId } from "./directory.js";

function fill(d: Directory, slug: "plaza", shard: number, n: number) {
  for (let i = 0; i < n; i++) d.occupy(shardId(slug, shard));
}

describe("Directory", () => {
  it("fills the lowest shard up to the soft cap before opening the next", () => {
    const d = new Directory();
    expect(d.assign("plaza")).toEqual({ ok: true, shard: 0, shardId: "room:plaza:0" });
    fill(d, "plaza", 0, 39);
    expect(d.assign("plaza")).toMatchObject({ shard: 0 });
    fill(d, "plaza", 0, 1);
    expect(d.assign("plaza")).toMatchObject({ shard: 1 });
    fill(d, "plaza", 1, 40);
    expect(d.assign("plaza")).toMatchObject({ shard: 2 });
    d.release(shardId("plaza", 0));
    expect(d.assign("plaza")).toMatchObject({ shard: 0 }); // a gap in a lower shard is refilled first
  });

  it("honours invites up to the hard cap, then falls back to normal placement", () => {
    const d = new Directory();
    fill(d, "plaza", 3, 59);
    expect(d.assign("plaza", 3)).toMatchObject({ shard: 3 });
    fill(d, "plaza", 3, 1);
    expect(d.assign("plaza", 3)).toMatchObject({ shard: 0 });
    expect(d.assign("plaza", 999)).toMatchObject({ shard: 0 });
  });

  it("uses the hard-cap headroom only when every shard is at the soft cap, then reports full", () => {
    const d = new Directory({ maxShards: 2 });
    fill(d, "plaza", 0, 40);
    fill(d, "plaza", 1, 40);
    expect(d.assign("plaza")).toMatchObject({ shard: 0 });
    fill(d, "plaza", 0, 20);
    fill(d, "plaza", 1, 20);
    expect(d.assign("plaza")).toEqual({ ok: false, reason: "full" });
  });

  it("reports populations per room and occupied shards", () => {
    const d = new Directory();
    fill(d, "plaza", 0, 3);
    fill(d, "plaza", 2, 2);
    d.occupy(shardId("sky-docks", 0));
    expect(d.populations()).toEqual({ plaza: 5, "pixel-arena": 0, "seed-booth": 0, "sky-docks": 1, "daily-gate": 0 });
    expect(d.shards("plaza")).toEqual([
      { shard: 0, count: 3 },
      { shard: 2, count: 2 },
    ]);
    d.release(shardId("sky-docks", 0));
    d.release(shardId("sky-docks", 0));
    expect(d.count(shardId("sky-docks", 0))).toBe(0);
  });

  it("routes owners case-insensitively and ignores stale offline calls", () => {
    const d = new Directory();
    d.ownerOnline("0xABC", "room:plaza:0", "s1");
    d.ownerOnline("0xabc", "room:sky-docks:1", "s2");
    d.ownerOffline("0xabc", "s1");
    expect(d.ownerRoute("0xAbC")).toEqual({ shard: "room:sky-docks:1", session: "s2" });
    d.ownerOffline("0xabc", "s2");
    expect(d.ownerRoute("0xabc")).toBeUndefined();
  });

  it("parses ?shard= leniently", () => {
    expect(parseShardParam("2")).toBe(2);
    expect(parseShardParam("-1")).toBeNull();
    expect(parseShardParam("1e3")).toBeNull();
    expect(parseShardParam("16")).toBeNull();
    expect(parseShardParam(null)).toBeNull();
  });
});
