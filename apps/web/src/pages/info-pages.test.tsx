import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { remote } from "../ui/index.js";
import { AboutPage, ONE_SENTENCE_RULE } from "./AboutPage.js";
import { EconomyPage } from "./EconomyPage.js";
import { demoListings, type GoldListing, MarketPage } from "./MarketPage.js";

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
  const listing: GoldListing = {
    id: "l1",
    originTokenId: "65040",
    sellerTokenId: "63675",
    priceMicro: 50_000_000,
    listedAt: NOW - 3600_000,
  };

  it("confirms a simulated purchase with the fee split", async () => {
    const onBuy = vi.fn(async () => undefined);
    render(
      <MarketPage
        listings={remote.ready([listing])}
        viewerTokenId="1969"
        balanceMicro={60_000_000}
        onBuy={onBuy}
        now={NOW}
      />,
    );
    expect(screen.getAllByText("SIMULATED").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "buy gold pixel for 50.00 RF" }));
    const dialog = screen.getByRole("dialog", { name: "buy gold pixel" });
    expect(within(dialog).getByText("royalty to origin #65040")).toBeTruthy();
    expect(within(dialog).getByText("95 % · 47.50 RF")).toBeTruthy();
    expect(within(dialog).getAllByText("2 % · 1.00 RF")).toHaveLength(2);
    expect(within(dialog).getByText("1 % · 0.50 RF")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "buy · 50.00 RF" }));
    expect(onBuy).toHaveBeenCalledWith(listing);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("no gold for sale")).toBeTruthy();
  });

  it("keeps a failed purchase open with the reason", async () => {
    const onBuy = vi.fn(async () => {
      throw new Error("Listing already sold.");
    });
    render(
      <MarketPage
        listings={remote.ready([listing])}
        viewerTokenId="1969"
        balanceMicro={null}
        onBuy={onBuy}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /buy gold pixel/ }));
    await userEvent.click(screen.getByRole("button", { name: "buy · 50.00 RF" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Listing already sold.");
    expect(screen.getByRole("button", { name: "retry · 50.00 RF" })).toBeTruthy();
  });

  it("lets guests browse only and blocks buying your own listing", () => {
    const { rerender } = render(
      <MarketPage
        listings={remote.ready([listing])}
        viewerTokenId={null}
        balanceMicro={null}
        onBuy={async () => undefined}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: /buy gold pixel/ })).toHaveProperty("disabled", true);
    rerender(
      <MarketPage
        listings={remote.ready([listing])}
        viewerTokenId="63675"
        balanceMicro={null}
        onBuy={async () => undefined}
        now={NOW}
      />,
    );
    expect(screen.getByRole("button", { name: /buy gold pixel/ }).textContent).toBe("your listing");
  });

  it("sorts by price or recency, and demo listings sit at or above the floor", async () => {
    const list = demoListings(NOW, 5);
    expect(list.every((l) => l.priceMicro >= 45_000_000)).toBe(true);
    expect(demoListings(NOW, 5)).toEqual(list);
    render(<MarketPage listings={remote.ready(list)} viewerTokenId={null} balanceMicro={null} now={NOW} />);
    const prices = () =>
      within(screen.getByRole("list", { name: "5 listings" }))
        .getAllByRole("heading")
        .map((h) => h.textContent);
    const byPrice = [...list]
      .sort((a, b) => a.priceMicro - b.priceMicro)
      .map((l) => `${(l.priceMicro / 1e6).toFixed(2)} RF`);
    expect(prices()).toEqual(byPrice);
    await userEvent.click(screen.getByRole("tab", { name: "newest" }));
    const byTime = [...list]
      .sort((a, b) => b.listedAt - a.listedAt)
      .map((l) => `${(l.priceMicro / 1e6).toFixed(2)} RF`);
    expect(prices()).toEqual(byTime);
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
