/** Wiring tests: routed pages against a stubbed API and real services (identity, meta book, toasts). */
import { EMPTY_LAYOUT, EMPTY_STATS, type MarketBookRes, type MetaMeRes } from "@pl/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../../api/client.js";
import { createServices, type Services, ServicesContext } from "../../app/services.js";
import { ACCOUNT, flush, ownedView } from "../../test/fixtures.js";
import GreenhouseRoute from "./GreenhouseRoute.js";
import InboxRoute from "./InboxRoute.js";
import MarketRoute from "./MarketRoute.js";

afterEach(cleanup);

const props = { params: {}, search: new URLSearchParams() };

function metaMe(bits: number): MetaMeRes {
  return {
    home: {
      tokenId: "344030",
      generation: 3,
      plots: 0,
      terraces: 2,
      layout: EMPTY_LAYOUT,
      hat: null,
      open: false,
      belt: null,
      stamps: [],
      stampXp: 0,
    },
    bits,
    owned: {},
    stats: EMPTY_STATS,
    economy: "sim",
    simRfMicro: 60_000_000,
  };
}

/** Real services with the given API methods stubbed, optionally signed in as the owner of #344030. */
async function setup(stubs: Partial<Api>, owner = true): Promise<Services> {
  const s = createServices();
  Object.assign(s.api, { metaMe: vi.fn(async () => metaMe(400)) }, stubs);
  if (owner) s.identity.setOwner(ACCOUNT, ownedView("344030"), { balanceMicro: 60_000_000, unread: 2 });
  await flush();
  return s;
}

const wrap = (s: Services, node: ReactNode) => <ServicesContext value={s}>{node}</ServicesContext>;

describe("InboxRoute", () => {
  it("renders every notification kind with its simulated label and marks all read", async () => {
    const inboxRead = vi.fn(async () => ({ unread: 0 }));
    const s = await setup({
      inbox: vi.fn(async () => ({
        unread: 2,
        items: [
          {
            id: "a",
            tokenId: "344030",
            createdAt: Date.now() - 60_000,
            readAt: null,
            kind: "market_sold" as const,
            mode: "sim" as const,
            leafId: 3,
            buyer: "7",
            priceMicro: 50_000_000,
            toSellerMicro: 47_500_000,
            toOriginMicro: 0,
          },
          { id: "b", tokenId: "344030", createdAt: Date.now() - 120_000, readAt: null, kind: "whole" as const },
        ],
      })),
      inboxRead,
    });
    render(wrap(s, <InboxRoute {...props} />));
    const list = await screen.findByRole("list", { name: "2 notifications" });
    expect(within(list).getByText(/bought your Gold Pixel/)).toBeTruthy();
    expect(within(list).getAllByText("SIMULATED")).toHaveLength(1);
    await flush();
    expect(inboxRead).toHaveBeenCalledWith({ all: true });
    const identity = s.identity.store.get().identity;
    expect(identity.mode === "owner" && identity.unread).toBe(0);
    await userEvent.click(screen.getByRole("tab", { name: "mends" }));
    expect(screen.getByRole("list", { name: "1 notifications" }).textContent).toMatch(/whole again/);
  });

  it("asks guests to bring their own Friend", async () => {
    const s = await setup({}, false);
    render(wrap(s, <InboxRoute {...props} />));
    expect(screen.getByRole("link", { name: "use my friend" })).toBeTruthy();
  });
});

describe("MarketRoute", () => {
  it("buys at the exact ask and folds the new balance into the identity", async () => {
    const book: MarketBookRes = {
      mode: "sim",
      simulated: true,
      floorMicro: 50_000_000,
      backingMicro: 45_000_000,
      listings: [{ leafId: 11, originFriendId: "65040", seller: "63675", priceMicro: 50_000_000, listedAt: 0 }],
      openListings: 1,
      recentFills: [],
      volume24hMicro: 0,
      fills24h: 0,
      burned24hMicro: 0,
      lastPriceMicro: null,
    };
    const marketBuy = vi.fn(async () => ({
      simulated: true as const,
      goldHeld: 1,
      balanceMicro: 10_000_000,
      fill: {
        kind: "Sold" as const,
        leafId: 11,
        originFriendId: "65040",
        buyer: "344030",
        seller: "63675",
        priceMicro: 50_000_000,
        burnedMicro: 1_000_000,
        toOriginMicro: 1_000_000,
        toCreatorMicro: 500_000,
        toSellerMicro: 47_500_000,
        at: 1,
      },
    }));
    const marketBook = vi.fn(async () => book);
    const s = await setup({
      marketBook,
      marketMine: vi.fn(async () => ({
        simulated: true as const,
        tokenId: "344030",
        goldHeld: 0,
        boughtLeafIds: [],
        listings: [],
        royaltiesMicro: 0,
      })),
      marketBuy,
    });
    render(wrap(s, <MarketRoute {...props} />));
    await userEvent.click(await screen.findByRole("button", { name: "buy gold pixel 11 for 50.00 RF" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "buy · 50.00 RF" }));
    expect(marketBuy).toHaveBeenCalledWith(11, 50_000_000);
    const identity = s.identity.store.get().identity;
    expect(identity.mode === "owner" && identity.balanceMicro).toBe(10_000_000);
    expect(marketBook.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("GreenhouseRoute", () => {
  it("shows the server Bits and buys through the meta API", async () => {
    const buyItem = vi.fn(async () => ({ item: "rock", owned: 1, bits: 250, stamps: [] }));
    const s = await setup({ buyItem });
    render(wrap(s, <GreenhouseRoute {...props} />));
    // The header shows the balance (a 400-bit bench sits on the shelf too).
    expect((await screen.findAllByText("400 bits")).length).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "buy Mossy rock for 150 bits" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "buy · 150 bits" }));
    expect(buyItem).toHaveBeenCalledWith("rock");
    expect(s.meta.store.get().me?.bits).toBe(250);
    // Planter (250 bits) is on the shelf; the header is the second match.
    expect((await screen.findAllByText("250 bits")).length).toBe(2);
  });
});
