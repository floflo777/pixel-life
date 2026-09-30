import { describe, expect, it } from "vitest";
import { FRIEND_FIXTURES, fixtureAppearance } from "../__fixtures__/friends.js";
import { EMPTY_MASK, fromIndices } from "../bitmap.js";
import { frontMask } from "../friend.js";
import { emptyShape, FriendPixels, SLOT_BODY, SLOT_SCAR } from "./pixels.js";
import { Rng } from "./rng.js";
import { blockMask } from "./testkit.js";

function bite(p: FriendPixels, ax: number, az: number, k: number, glanced: number[] = []): number[] {
  const s = emptyShape();
  p.measure(0, s);
  return p.selectBite(0, s, ax, az, k, new Rng(1, 1), glanced);
}

describe("FriendPixels", () => {
  const front = blockMask(8, 10); // columns 4..11, rows 3..12

  it("counts N0, prior scars and measures the body", () => {
    const p = new FriendPixels(front, fromIndices([3 * 16 + 4]), undefined);
    expect(p.n0).toBe(80);
    expect(p.startPresent).toBe(79);
    expect(p.slot[3 * 16 + 4]).toBe(SLOT_SCAR);
    const s = emptyShape();
    p.measure(0, s);
    expect(s.count).toBe(79);
    expect([s.minCol, s.maxCol, s.minRow, s.maxRow]).toEqual([4, 11, 3, 12]);
    expect(s.r).toBeCloseTo(0.45 * 8);
  });

  it("maps the contact direction to sprite sides (GDD §2.5)", () => {
    const p = new FriendPixels(front, EMPTY_MASK, undefined);
    // Attacker on the left (a = +x) → left column; on the right → right column.
    for (const pid of bite(p, 1, 0, 4)) expect(pid & 15).toBe(4);
    for (const pid of bite(p, -1, 0, 4)) expect(pid & 15).toBe(11);
    // From behind (far side, a = +z) → top rows (head); from the near side → bottom rows (feet).
    for (const pid of bite(p, 0, 1, 4)) expect(pid >> 4).toBe(3);
    for (const pid of bite(p, 0, -1, 4)) expect(pid >> 4).toBe(12);
  });

  it("only takes boundary pixels, prefers exposed corners, and is deterministic", () => {
    const p = new FriendPixels(front, EMPTY_MASK, undefined);
    const picked = bite(p, 0.7071, 0.7071, 1);
    expect(picked).toEqual([3 * 16 + 4]);
    expect(bite(p, 0.3, 0.9, 5)).toEqual(bite(p, 0.3, 0.9, 5));
    const all = bite(p, 1, 0, 200);
    expect(all.length).toBe(2 * 10 + 2 * 6); // the ring only
  });

  it("glances off gold onto the next ink pixel and cracks it", () => {
    const corner = 3 * 16 + 4;
    const p = new FriendPixels(front, EMPTY_MASK, fromIndices([corner]));
    const glanced: number[] = [];
    const picked = bite(p, 0.7071, 0.7071, 1, glanced);
    expect(glanced).toEqual([corner]);
    expect(picked).toHaveLength(1);
    expect(picked[0]).not.toBe(corner);
    expect(p.cracks[corner]).toBe(1);
    expect(p.slot[corner]).toBe(SLOT_BODY);
  });

  it("gold on a scar is ignored; splits by columns and merges back", () => {
    const p = new FriendPixels(front, fromIndices([3 * 16 + 4]), fromIndices([3 * 16 + 4]));
    expect(p.gold[3 * 16 + 4]).toBe(0);
    expect(p.split()).toBe(true);
    const s0 = emptyShape();
    const s1 = emptyShape();
    p.measure(0, s0);
    p.measure(1, s1);
    expect(s0.count + s1.count).toBe(79);
    expect(s0.maxCol).toBeLessThan(s1.minCol);
    p.merge();
    p.measure(0, s0);
    expect(s0.count).toBe(79);
  });

  it("finds the heavy side (Asymmetry): #1969 hooks right (GDD §9.4), a symmetric block ties right", () => {
    const fx = FRIEND_FIXTURES.find((f) => f.tokenId === "1969");
    if (!fx) throw new Error("fixture");
    expect(new FriendPixels(frontMask(fixtureAppearance(fx)), EMPTY_MASK, undefined).heavySide()).toBe(1);
    expect(new FriendPixels(front, EMPTY_MASK, undefined).heavySide()).toBe(1);
    const leftBlob = fromIndices([5 * 16 + 3, 6 * 16 + 3]);
    expect(new FriendPixels(orMask(front, leftBlob), EMPTY_MASK, undefined).heavySide()).toBe(-1);
  });
});

function orMask(a: string, b: string): string {
  let out = "";
  for (let i = 0; i < 64; i++)
    out += (Number.parseInt(a.charAt(i), 16) | Number.parseInt(b.charAt(i), 16)).toString(16);
  return out;
}
