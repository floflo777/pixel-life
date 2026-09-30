import { EMPTY_MASK, fromIndices, getBit, popcount } from "@pl/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureView, FIXTURE_FRONT } from "../pages/__fixtures__/friend.js";
import { FriendPortrait, paintPortrait, portraitGeometry, portraitLayers, type Paint2D } from "./index.js";
import { COLORS } from "./tokens.js";

afterEach(cleanup);

function recorder() {
  const calls: { fill: string; rect: [number, number, number, number] }[] = [];
  const ctx: Paint2D = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    clearRect() {},
    fillRect(x, y, w, h) {
      calls.push({ fill: String(ctx.fillStyle), rect: [x, y, w, h] });
    },
    strokeRect() {},
  };
  return { ctx, calls };
}

describe("portraitLayers", () => {
  it("derives N/N0, scars, gold and stitches from public state", () => {
    const n0 = popcount(FIXTURE_FRONT);
    const whole = portraitLayers(fixtureView());
    expect(whole.n0).toBe(n0);
    expect(whole.n).toBe(n0);
    expect(whole.nextHeal).toBe(-1);

    const v = fixtureView({ lostCount: 5, goldHeld: 1 });
    const l = portraitLayers(v);
    expect(l.n).toBe(n0 - 5);
    expect(l.cells.filter((c) => c === "scar" || c === "heal-next")).toHaveLength(5);
    expect(l.cells.filter((c) => c === "heal-next")).toHaveLength(1);
    expect(l.cells.filter((c) => c === "gold")).toHaveLength(1);
    // Gold never sits on a scar.
    l.cells.forEach((c, i) => {
      if (c === "gold") expect(getBit(l.lost, i)).toBe(false);
    });
  });

  it("hides gold on loaned Friends and stitches on scars", () => {
    const base = fixtureView({ lostCount: 3 });
    const scar = base.pub.scars.lost;
    const aScar = Array.from({ length: 256 }, (_, i) => i).find((i) => getBit(scar, i)) ?? -1;
    const aPresent =
      Array.from({ length: 256 }, (_, i) => i).find((i) => getBit(FIXTURE_FRONT, i) && !getBit(scar, i)) ?? -1;
    const v = fixtureView({ lostCount: 3, goldHeld: 2, loaned: true, stitched: fromIndices([aScar, aPresent]) });
    const l = portraitLayers(v);
    expect(l.cells.includes("gold")).toBe(false);
    expect(l.cells[aPresent]).toBe("stitch");
    expect(l.cells[aScar]).not.toBe("stitch");
  });

  it("clips an override lost mask to the front mask", () => {
    const l = portraitLayers(fixtureView(), { lost: "f".repeat(64) });
    expect(l.n).toBe(0);
  });
});

describe("paintPortrait", () => {
  it("paints halo, ink, paper scars with coral dots and gold", () => {
    const v = fixtureView({ lostCount: 2, goldHeld: 1, streak: 7 });
    const layers = portraitLayers(v);
    const geo = portraitGeometry(8);
    const { ctx, calls } = recorder();
    paintPortrait(ctx, layers, geo, { haloColor: COLORS.coral, selected: EMPTY_MASK });
    const fills = new Set(calls.map((c) => c.fill));
    for (const c of [COLORS.ink, COLORS.coral, COLORS.paper, COLORS.gold, COLORS.goldSpec])
      expect(fills.has(c)).toBe(true);
    // Every pixel is drawn inside the canvas.
    for (const { rect } of calls) {
      expect(rect[0]).toBeGreaterThanOrEqual(0);
      expect(rect[0] + rect[2]).toBeLessThanOrEqual(geo.size);
    }
  });

  it("paints no halo when disabled", () => {
    const layers = portraitLayers(fixtureView());
    const { ctx, calls } = recorder();
    paintPortrait(ctx, layers, portraitGeometry(4), { haloColor: null, selected: EMPTY_MASK });
    expect(calls.every((c) => c.fill === COLORS.ink)).toBe(true);
    expect(calls).toHaveLength(layers.n0);
  });
});

describe("FriendPortrait", () => {
  it("describes the Friend for screen readers", () => {
    render(<FriendPortrait view={fixtureView({ lostCount: 4, goldHeld: 1 })} />);
    const img = screen.getByRole("img");
    const n0 = popcount(FIXTURE_FRONT);
    expect(img.getAttribute("aria-label")).toBe(`Friend #344030, Mask, ${n0 - 4} of ${n0} pixels, 4 missing, 1 gold`);
  });

  it("lets keyboard users pick scars with a roving tabindex", async () => {
    function Harness() {
      const [sel, setSel] = useState(EMPTY_MASK);
      return (
        <>
          <FriendPortrait
            view={fixtureView({ lostCount: 4 })}
            selection={{ selected: sel, onToggle: (i) => setSel((s) => fromIndices(toggle(s, i))) }}
          />
          <output>{popcount(sel)}</output>
        </>
      );
    }
    render(<Harness />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    expect(boxes.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("status").textContent).toBe("1");
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(1);
    await userEvent.click(boxes[1] as HTMLElement);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  });

  it("blocks new picks when full but still allows unpicking", async () => {
    const view = fixtureView({ lostCount: 3 });
    const first = Array.from({ length: 256 }, (_, i) => i).find((i) => getBit(view.pub.scars.lost, i)) ?? -1;
    const toggled: number[] = [];
    render(
      <FriendPortrait
        view={view}
        selection={{ selected: fromIndices([first]), onToggle: (i) => toggled.push(i), full: true }}
      />,
    );
    for (const b of screen.getAllByRole("checkbox")) await userEvent.click(b);
    expect(toggled).toEqual([first]);
  });
});

function toggle(mask: string, i: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < 256; j++) if (getBit(mask, j) !== (j === i)) out.push(j);
  return out;
}
