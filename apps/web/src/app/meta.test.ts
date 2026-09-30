import type { MetaMeRes } from "@pl/shared";
import { EMPTY_LAYOUT, EMPTY_STATS } from "@pl/shared";
import { describe, expect, it, vi } from "vitest";
import { createIdentity } from "../identity/store.js";
import { ACCOUNT, flush, ownedView } from "../test/fixtures.js";
import { createMetaBook } from "./meta.js";

const me = (bits: number, tokenId = "344030"): MetaMeRes => ({
  home: {
    tokenId,
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
  simRfMicro: 5_000_000,
});

describe("meta book", () => {
  it("stays empty for guests and loads the owner's server Bits", async () => {
    const identity = createIdentity();
    const metaMe = vi.fn(async () => me(420));
    const book = createMetaBook({ metaMe }, identity);
    await flush();
    expect(book.store.get().status).toBe("none");
    expect(metaMe).not.toHaveBeenCalled();
    identity.setOwner(ACCOUNT, ownedView("344030"));
    expect(book.store.get().status).toBe("loading");
    await flush();
    expect(book.store.get()).toMatchObject({ status: "ready", tokenId: "344030", me: { bits: 420 } });
    identity.dropOwner(null);
    await flush();
    expect(book.store.get().status).toBe("none");
    book.dispose();
  });

  it("refetches after identity updates (run acks, receipts) and applies purchases", async () => {
    const identity = createIdentity();
    let bits = 100;
    const metaMe = vi.fn(async () => me(bits));
    const book = createMetaBook({ metaMe }, identity);
    identity.setOwner(ACCOUNT, ownedView("344030"));
    await flush();
    bits = 130;
    identity.updateOwner({ balanceMicro: 1 });
    await flush();
    expect(book.store.get().me?.bits).toBe(130);
    book.applyBuy({ item: "rock", owned: 2, bits: (130 - 150) * -1, stamps: [], simRfMicro: 3_000_000 });
    expect(book.store.get().me).toMatchObject({ bits: 20, owned: { rock: 2 }, simRfMicro: 3_000_000 });
    book.applyPlot({ plots: 1, terraces: 3, bits: 0 });
    expect(book.store.get().me?.home).toMatchObject({ plots: 1, terraces: 3 });
    book.dispose();
  });

  it("keeps the last balance when a refresh fails", async () => {
    const identity = createIdentity();
    const metaMe = vi.fn(async () => me(50));
    const book = createMetaBook({ metaMe }, identity);
    identity.setOwner(ACCOUNT, ownedView("344030"));
    await flush();
    metaMe.mockRejectedValueOnce(new Error("offline"));
    await book.refresh();
    expect(book.store.get()).toMatchObject({ status: "error", me: { bits: 50 } });
    book.dispose();
  });
});
