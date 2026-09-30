import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remote } from "../ui/index.js";
import { AboutPage, ONE_SENTENCE_RULE } from "./AboutPage.js";
import { EconomyPage } from "./EconomyPage.js";
import type { MarketBookRes, MarketListing, MarketMineRes } from "@pl/shared";
import { MarketPage, parseRf } from "./MarketPage.js";

afterEach(cleanup);
const NOW = 1_700_000_000_000;

describe("EconomyPage", () => {
  it("shows every price, the odds, the simulated label and the contracts", () => {
    render(
      <EconomyPage
        mode="sim"
        now={NOW}
        stats={remote.ready({
          mode: "sim",
          simulated: true,
          burnedMicro: 1_250_000,
          streamMicro: 500_000,
          toFriendsMicro: 750_000,
          counts: { regrow: 3, mend: 2, seedPacks: 1 },
          since: 0,
          updatedAt: NOW - 120_000,
        })}
      />,
    );
    expect(screen.getByText(/Every RF amount in Pixel Life is SIMULATED/)).toBeTruthy();
    const prices = screen.getByRole("region", { name: "every price" });
    expect(within(prices).getByText("0.50 RF/px")).toBeTruthy();
    expect(within(prices).getByText("1.00 RF/px")).toBeTruthy();
    expect(within(prices).getByText("12 px/day")).toBeTruthy();
    const odds = screen.getByRole("region", { name: "seed pack odds" });
    expect(within(odds).getByText("56 %")).toBeTruthy();
    expect(within(odds).getByText("2 %")).toBeTruthy();
    expect(within(odds).getByText("4.48 RF")).toBeTruthy();
    expect(within(odds).getByText("44 % of packs")).toBeTruthy();
    expect(within(odds).getByText(/40 RF free stake per pack/)).toBeTruthy();
    expect(screen.getByText("not deployed · not audited")).toBeTruthy();
    expect(screen.getByText("0x0779369854d3EcdEA927206718FFD7730C67B71f")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "running totals" })).getByText("1.25 RF")).toBeTruthy();
  });

  it("says live when the server is live", () => {
    render(<EconomyPage mode="live" now={NOW} />);
    expect(screen.getAllByText("LIVE RF").length).toBeGreaterThan(0);
    expect(screen.queryByText(/is SIMULATED right now/)).toBeNull();
  });
});

describe("MarketPage", () => {
  const listing: MarketListing = {
    leafId: 11,
    originFriendId: "65040",
    seller: "63675",
    priceMicro: 50_000_000,
    listedAt: NOW - 3600_000,
  };
  const book = (listings: MarketListing[] = [listing]): MarketBookRes => ({
    mode: "sim",
    simulated: true,
    floorMicro: listings[0]?.priceMicro ?? null,
    backingMicro: 45_000_000,
    listings,
    openListings: listings.length,
    recentFills: [
      {
        kind: "Sold",
        leafId: 9,
        originFriendId: "65040",
        buyer: "1969",
        seller: "63675",
        priceMicro: 48_000_000,
        burnedMicro: 960_000,
        toOriginMicro: 960_000,
        toCreatorMicro: 480_000,
        toSellerMicro: 45_600_000,
        at: NOW - 60_000,
      },
    ],
    volume24hMicro: 48_000_000,
    fills24h: 1,
    burned24hMicro: 960_000,
    lastPriceMicro: 48_000_000,
  });
  const mine = (over: Partial<MarketMineRes> = {}): MarketMineRes => ({
    simulated: true,
    tokenId: "1969",
    goldHeld: 2,
    boughtLeafIds: [4],
    listings: [],
    royaltiesMicro: 960_000,
    ...over,
  });

  it("shows the book stats and confirms a simulated purchase at the exact price", async () => {
    const onBuy = vi.fn(async () => undefined);
    render(
      <MarketPage
        book={remote.ready(book())}
        mine={remote.ready(mine())}
        viewerTokenId="1969"
        balanceMicro={60_000_000}
        onBuy={onBuy}
        now={NOW}
      />,
    );
    expect(screen.getAllByText("SIMULATED").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("region", { name: "market stats" })).getByText("48.00 RF")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "buy gold pixel 11 for 50.00 RF" }));
    const dialog = screen.getByRole("dialog", { name: "buy gold pixel" });
    expect(within(dialog).getByText("royalty to origin #65040")).toBeTruthy();
    expect(within(dialog).getByText("95 % · 47.50 RF")).toBeTruthy();
    expect(within(dialog).getAllByText("2 % · 1.00 RF")).toHaveLength(2);
    expect(within(dialog).getByText("1 % · 0.50 RF")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "buy · 50.00 RF" }));
    expect(onBuy).toHaveBeenCalledWith(listing);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a failed purchase open with the reason", async () => {
    const onBuy = vi.fn(async () => {
      throw new Error("The price changed. Check the new price and try again.");
    });
    render(
      <MarketPage
        book={remote.ready(book())}
        mine={remote.ready(mine())}
        viewerTokenId="1969"
        balanceMicro={null}
        onBuy={onBuy}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /buy gold pixel/ }));
    await userEvent.click(screen.getByRole("button", { name: "buy · 50.00 RF" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/price changed/);
    expect(screen.getByRole("button", { name: "retry · 50.00 RF" })).toBeTruthy();
  });

  it("lets guests browse only and offers cancel on your own ask", async () => {
    const onCancel = vi.fn(async () => undefined);
    const { rerender } = render(
      <MarketPage book={remote.ready(book())} mine={null} viewerTokenId={null} balanceMicro={null} now={NOW} />,
    );
    expect(screen.getByRole("button", { name: /buy gold pixel/ })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("tab", { name: "my gold" })).toBeNull();
    rerender(
      <MarketPage
        book={remote.ready(book())}
        mine={remote.ready(mine())}
        viewerTokenId="63675"
        balanceMicro={null}
        onBuy={async () => undefined}
        onCancel={onCancel}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "take gold pixel 11 off the market" }));
    expect(onCancel).toHaveBeenCalledWith(11);
  });

  it("lists recent fills and an empty book", async () => {
    render(<MarketPage book={remote.ready(book([]))} mine={null} viewerTokenId={null} balanceMicro={null} now={NOW} />);
    expect(screen.getByText("no gold for sale")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "recent sales" }));
    expect(screen.getByRole("table").textContent).toContain("#63675 → #1969");
  });

  it("lists a bought Gold at a valid price and explains a bad one", async () => {
    const onList = vi.fn(async () => undefined);
    render(
      <MarketPage
        book={remote.ready(book())}
        mine={remote.ready(mine())}
        viewerTokenId="1969"
        balanceMicro={null}
        onList={onList}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "my gold" }));
    const price = screen.getByRole("textbox", { name: "price (RF, simulated)" });
    await userEvent.clear(price);
    await userEvent.type(price, "40");
    expect(screen.getByText(/The lowest ask is 45 RF/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^list/ })).toHaveProperty("disabled", true);
    await userEvent.clear(price);
    await userEvent.type(price, "52.5");
    expect(screen.getByText(/You receive 49.87 RF/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "which gold" }), "4");
    await userEvent.click(screen.getByRole("button", { name: "list · 52.50 RF" }));
    expect(onList).toHaveBeenCalledWith(52_500_000, 4);
    expect(await screen.findByText("Listed for 52.50 RF (simulated).")).toBeTruthy();
  });

  it("parses RF amounts exactly", () => {
    expect(parseRf("52.5")).toBe(52_500_000);
    expect(parseRf("45")).toBe(45_000_000);
    expect(parseRf("0,01")).toBe(10_000);
    expect(parseRf("abc")).toBeNull();
    expect(parseRf("1.1234567")).toBeNull();
  });
});

describe("AboutPage", () => {
  it("states the rule, the controls and the hub rooms", async () => {
    const onPlay = vi.fn();
    render(<AboutPage onPlay={onPlay} />);
    expect(screen.getByText(ONE_SENTENCE_RULE)).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "keyboard" })).toBeTruthy();
    expect(screen.getByText("pixel-arena")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "▶ play" }));
    expect(onPlay).toHaveBeenCalled();
  });
});
