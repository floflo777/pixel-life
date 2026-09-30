import { describe, expect, it } from "vitest";
import { GULP_EV_BITE, GULP_EV_REGROW, GULP_EV_RUMBLE, GULP_EV_TOOTH_HIT, GULP_EV_TOOTH_LIT } from "./events.js";
import { angleOf } from "./fixed-math.js";
import { GULP_DONE, GULP_SHADOW, GULP_TEETH_OUT } from "./gulp.js";
import { blockConfig, eventsOf, fling } from "./testkit.js";
import * as T from "./tuning.js";
import { World } from "./world.js";

function worldAt(tick: number, seed = 5): World {
  const w = new World(blockConfig({ seed }));
  w.invulnUntil = 1e9;
  while (w.tick < tick) {
    w.step([]);
    w.creatures = [];
  }
  return w;
}

describe("Old Gulp (GDD §3.8)", () => {
  it("rumbles, bites the wedge, lights three teeth in turn, then the wedge regrows", () => {
    const w = worldAt(T.GULP_RUMBLE + 1);
    expect(w.gulp.phase).toBe(GULP_SHADOW);
    expect(w.island.wedgeShadow).toBe(true);
    while (w.tick <= T.GULP_TEETH + 2) w.step([]);
    expect(w.gulp.phase).toBe(GULP_TEETH_OUT);
    expect(w.island.wedgeOn).toBe(true);
    expect(w.gulp.teeth).toHaveLength(3);
    for (const t of w.gulp.teeth) expect(w.island.edgeDistance(t.x, t.z)).toBeLessThan(1);
    while (!w.done) w.step([]);
    const beats = eventsOf(w, "gulp").map((e) => e.a);
    expect(beats.slice(0, 2)).toEqual([GULP_EV_RUMBLE, GULP_EV_BITE]);
    expect(beats.filter((b) => b === GULP_EV_TOOTH_LIT)).toHaveLength(3);
    expect(beats.at(-1)).toBe(GULP_EV_REGROW);
    expect(w.gulp.phase).toBe(GULP_DONE);
    expect(w.island.wedgeOn).toBe(false);
  });

  it("a hard fling into the lit tooth scores +100 and rebounds onto the island", () => {
    const w = worldAt(T.GULP_TEETH + 2);
    const lit = w.gulp.teeth[w.gulp.lit];
    if (!lit) throw new Error("no lit tooth");
    const b = w.body(0);
    const l = Math.sqrt(lit.x * lit.x + lit.z * lit.z);
    b.x = lit.x - (lit.x / l) * 12;
    b.z = lit.z - (lit.z / l) * 12;
    const before = w.score;
    w.step([fling(w, angleOf(lit.x - b.x, lit.z - b.z), 1023)]);
    for (let i = 0; i < 20; i++) w.step([]);
    expect(eventsOf(w, "gulp").some((e) => e.a === GULP_EV_TOOTH_HIT)).toBe(true);
    expect(w.score - before).toBeGreaterThanOrEqual(T.PTS_TOOTH);
    expect(w.ringouts).toBe(0);
  });

  it("mood, wedge jitter and tooth order depend only on the seed", () => {
    const moods = new Set<number>();
    for (let s = 0; s < 40; s++) {
      const a = new World(blockConfig({ seed: s }));
      const b = new World(blockConfig({ seed: s }));
      expect(a.gulp.mood).toBe(b.gulp.mood);
      expect(a.gulp.order).toEqual(b.gulp.order);
      expect([...a.gulp.order].sort()).toEqual([0, 1, 2]);
      moods.add(a.gulp.mood);
    }
    expect(moods.size).toBe(3);
  });
});
