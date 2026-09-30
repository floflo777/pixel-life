import {
  CATALOG,
  catalogItem,
  EMPTY_LAYOUT,
  EMPTY_STATS,
  type HomeView,
  type SkyFriend,
  stampDef,
  type CatalogItem,
} from "@pl/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureView } from "./__fixtures__/friend.js";
import { Catalog, priceLabel } from "./Catalog.js";
import { cssColor, stampProgress, unlockProblem, unplaced } from "./meta-view.js";
import { mergeSky } from "./routes/MendBoardRoute.js";
import { BeltLadder, StampBook } from "./StampBook.js";

afterEach(cleanup);

const item = (id: string): CatalogItem => {
  const i = catalogItem(id);
  if (!i) throw new Error(id);
  return i;
};

describe("meta view helpers", () => {
  it("explains locked flex items by stamp or belt", () => {
    expect(unlockProblem(item("rock"), new Set(), null)).toBeNull();
    expect(unlockProblem(item("gulp_tooth"), new Set(), null)).toBe("earn the Gulp Gourmet stamp");
    expect(unlockProblem(item("gulp_tooth"), new Set(["gulp_gourmet"]), null)).toBeNull();
    expect(unlockProblem(item("dojo_mat"), new Set(), "yellow")).toBe("earn the green belt");
    expect(unlockProblem(item("dojo_mat"), new Set(), "blue")).toBeNull();
  });

  it("measures counting stamps and leaves run stamps alone", () => {
    const pops = stampDef("snack_time");
    const kind = stampDef("kind_stranger");
    const flawless = stampDef("flawless");
    if (!pops || !kind || !flawless) throw new Error("stamps");
    const stats = { ...EMPTY_STATS, pops: 40, mendTargets: ["1", "2", "3"] };
    expect(stampProgress(pops, stats)).toEqual({ have: 40, need: 100 });
    expect(stampProgress(kind, stats)).toEqual({ have: 3, need: 10 });
    expect(stampProgress(pops, { ...stats, pops: 500 })).toEqual({ have: 100, need: 100 });
    expect(stampProgress(flawless, stats)).toBeNull();
  });

  it("counts what is left to place and formats belt colours", () => {
    const layout = {
      v: 1 as const,
      items: [
        { item: "rock", t: 0, x: 0, z: 0, r: 0 as const },
        { item: "rock", t: 0, x: 1, z: 0, r: 0 as const },
      ],
    };
    expect(unplaced({ rock: 3, bench: 1 }, layout)).toEqual({ rock: 1, bench: 1 });
    expect(unplaced({ rock: 1 }, layout)).toEqual({ rock: 0 });
    expect(cssColor(0x111111)).toBe("#111111");
    expect(cssColor(0xff)).toBe("#0000ff");
  });

  it("prices items with their blueprint", () => {
    expect(priceLabel(item("rock"))).toBe("150 bits");
    expect(priceLabel(item("sun_lantern"))).toBe("2.00 RF");
    expect(priceLabel(item("gold_arch"))).toMatch(/^10\.00 RF \+ 1.000 bits blueprint$/);
  });

  it("merges the Sky rooms keeping the freshest scars", () => {
    const f = (tokenId: string, updatedAt: number): SkyFriend => {
      const v = fixtureView({ tokenId, lostCount: 2, updatedAt });
      return { tokenId, familyId: 1, pub: v.pub };
    };
    const merged = mergeSky([[f("1", 10), f("2", 5)], [f("1", 20)], []]);
    expect(merged.map((x) => [x.tokenId, x.pub.scars.updatedAt])).toEqual([
      ["1", 20],
      ["2", 5],
    ]);
  });
});

describe("Catalog", () => {
  it("buys a Bits item through the confirm sheet", async () => {
    const onBuy = vi.fn(async () => undefined);
    render(
      <Catalog
        items={CATALOG}
        owned={{ rock: 1 }}
        bits={400}
        heldStamps={new Set()}
        belt={null}
        mode="sim"
        balanceMicro={10_000_000}
        onBuy={onBuy}
      />,
    );
    const rock = screen.getByRole("heading", { name: "Mossy rock" }).closest("li");
    if (!rock) throw new Error("rock card");
    expect(within(rock).getByText(/owned 1/)).toBeTruthy();
    await userEvent.click(within(rock).getByRole("button", { name: "buy Mossy rock for 150 bits" }));
    const sheet = screen.getByRole("dialog", { name: "buy Mossy rock" });
    expect(within(sheet).getByText("400 → 250")).toBeTruthy();
    await userEvent.click(within(sheet).getByRole("button", { name: "buy · 150 bits" }));
    expect(onBuy).toHaveBeenCalledWith(catalogItem("rock"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels RF decor SIMULATED with its split and blocks what the player can't afford", async () => {
    render(
      <Catalog
        items={CATALOG}
        owned={{}}
        bits={100}
        heldStamps={new Set()}
        belt={null}
        mode="sim"
        balanceMicro={1_000_000}
        onBuy={async () => undefined}
        initialShelf="premium"
      />,
    );
    expect(screen.getAllByText("SIMULATED").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "buy Sun lantern for 2.00 RF" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getAllByText("50 % · 1.00 RF")).toHaveLength(2);
    expect(within(sheet).getByText("Not enough simulated RF.")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "buy · 2.00 RF" })).toHaveProperty("disabled", true);
  });

  it("shows locks on the flex shelf and lets guests browse only", async () => {
    render(
      <Catalog
        items={CATALOG}
        owned={null}
        bits={null}
        heldStamps={new Set()}
        belt={null}
        mode="sim"
        balanceMicro={null}
      />,
    );
    expect(screen.getByText(/Buying needs your own Friend/)).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "flex" }));
    expect(screen.getByText("locked: earn the black belt")).toBeTruthy();
    for (const b of screen.getAllByRole("button", { name: /^buy / })) expect(b).toHaveProperty("disabled", true);
  });

  it("keeps a refused purchase open with the server's reason", async () => {
    render(
      <Catalog
        items={CATALOG}
        owned={{}}
        bits={400}
        heldStamps={new Set()}
        belt={null}
        mode="sim"
        balanceMicro={null}
        onBuy={async () => {
          throw new Error("Not enough Bits.");
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "buy Mossy rock for 150 bits" }));
    await userEvent.click(screen.getByRole("button", { name: "buy · 150 bits" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not enough Bits.");
    expect(screen.getByRole("button", { name: "retry · 150 bits" })).toBeTruthy();
  });
});

describe("StampBook", () => {
  const home: HomeView = {
    tokenId: "344030",
    generation: 3,
    plots: 0,
    terraces: 2,
    layout: EMPTY_LAYOUT,
    hat: null,
    open: true,
    belt: "yellow",
    stamps: [{ id: "first_flight", at: Date.UTC(2026, 8, 30) }],
    stampXp: 25,
  };

  it("shows held and missing stamps, progress for the owner and the worn belt", async () => {
    render(<StampBook home={home} stats={{ ...EMPTY_STATS, runs: 4 }} own />);
    expect(screen.getByText("1/24")).toBeTruthy();
    expect(screen.getByText("earned 2026-09-30")).toBeTruthy();
    const regular = screen.getByText("Regular").closest("li");
    if (!regular) throw new Error("regular");
    expect(within(regular).getByRole("meter", { name: "Regular" }).getAttribute("aria-valuetext")).toBe("4 of 10");
    const worn = screen.getByRole("list", { name: "fling belts" }).querySelector('[aria-current="step"]');
    expect(worn?.textContent).toMatch(/Yellow.*worn/);
    await userEvent.click(screen.getByRole("tab", { name: "care" }));
    expect(screen.getByText("First Stitch")).toBeTruthy();
  });

  it("marks the next trial on the ladder", () => {
    render(<BeltLadder belt={null} />);
    const items = within(screen.getByRole("list", { name: "fling belts" })).getAllByRole("listitem");
    expect(items[0]?.textContent).toMatch(/White.*next$/);
    expect(items[1]?.textContent).toMatch(/locked$/);
  });
});
