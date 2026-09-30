import { EMPTY_MASK, frontMask, maxPersistedLost, popcount, setBit, toIndices } from "@pl/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT, loaner, LOANERS, ownedView } from "../test/fixtures.js";
import { guestFriendView, loadGuestProfile } from "./guest.js";
import { dayNumber, loanerOfTheDay, loadLoaners } from "./loaners.js";
import { createIdentity } from "./store.js";

const T0 = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

describe("loaners", () => {
  it("loads the 12 baked Friends lazily and validates them", async () => {
    const l = await loadLoaners();
    expect(l).toHaveLength(12);
    expect(l[0]?.appearance.frames).toHaveLength(64);
  });

  it("rotates the loaner of the day", () => {
    const a = loanerOfTheDay(LOANERS, T0);
    const b = loanerOfTheDay(LOANERS, T0 + 86_400_000);
    expect(a).not.toBe(b);
    expect(loanerOfTheDay(LOANERS, T0 + 1000)).toBe(a);
    expect(LOANERS.indexOf(a)).toBe(dayNumber(T0) % 12);
  });
});

describe("identity store", () => {
  it("guest scars stay local, respect the 50 % floor, and persist across reloads", () => {
    const id = createIdentity({ now: () => T0 });
    const l = loaner();
    id.startGuest(l);
    const front = frontMask(l.appearance);
    const all = toIndices(front).reduce((m, i) => setBit(m, i, true), EMPTY_MASK);
    id.applyGuestLoss(all);
    const s = id.store.get().identity;
    expect(s.mode).toBe("guest");
    const lost = s.mode === "guest" ? s.view.pub.scars.lost : EMPTY_MASK;
    expect(popcount(lost)).toBe(maxPersistedLost(popcount(front)));
    expect(s.mode === "guest" && s.view.loaned).toBe(true);

    // Reload: a new store reads the same profile.
    const again = createIdentity({ now: () => T0 });
    again.startGuest(l);
    const s2 = again.store.get().identity;
    expect(s2.mode === "guest" && s2.view.pub.scars.lost).toBe(lost);
    expect(loadGuestProfile().loaner).toBe(l.appearance.tokenId);
  });

  it("guest scars heal for free over time on the local copy", () => {
    const l = loaner();
    const id = createIdentity({ now: () => T0 });
    id.startGuest(l);
    const first = toIndices(frontMask(l.appearance))[0] ?? 0;
    id.applyGuestLoss(setBit(EMPTY_MASK, first, true));
    const later = guestFriendView(l, loadGuestProfile(), T0 + 3 * 3_600_000);
    expect(later.pub.scars.lost).toBe(EMPTY_MASK);
  });

  it("owner binding bumps the revision; a refreshed view of the same Friend does not", () => {
    const id = createIdentity({ now: () => T0 });
    id.startGuest(loaner());
    const r0 = id.store.get().revision;
    id.setOwner(ACCOUNT, ownedView("344030"));
    const r1 = id.store.get().revision;
    expect(r1).toBe(r0 + 1);
    id.setOwner(ACCOUNT, ownedView("344030"), { balanceMicro: 5 });
    expect(id.store.get().revision).toBe(r1);
    id.setOwner(ACCOUNT, ownedView("344033"));
    expect(id.store.get().revision).toBe(r1 + 1);
  });

  it("dropOwner falls back to the last loaner with a notice", () => {
    const id = createIdentity({ now: () => T0 });
    id.startGuest(loaner(2));
    id.setOwner(ACCOUNT, ownedView());
    id.dropOwner("changed");
    const s = id.store.get();
    expect(s.identity.mode === "guest" && s.identity.loaner).toBe(loaner(2));
    expect(s.notice).toBe("changed");
    id.clearNotice();
    expect(id.store.get().notice).toBeNull();
  });

  it("syncMe restores an owner from /api/me and drops one the server forgot", () => {
    const id = createIdentity({ now: () => T0 });
    id.syncMe({
      identity: { kind: "owner", address: ACCOUNT },
      friend: ownedView(),
      balanceMicro: 20_000_000,
      unread: 3,
      economy: "sim",
    });
    const s = id.store.get().identity;
    expect(s.mode === "owner" && [s.balanceMicro, s.unread]).toEqual([20_000_000, 3]);
    id.syncMe({ identity: { kind: "anon" }, friend: null, balanceMicro: null, unread: 0, economy: "sim" });
    expect(id.store.get().identity.mode).toBe("none");
    expect(id.store.get().notice).toMatch(/session ended/);
  });

  it("updateOwner patches scars and balance without a revision bump", () => {
    const id = createIdentity({ now: () => T0 });
    id.setOwner(ACCOUNT, ownedView());
    const r = id.store.get().revision;
    id.updateOwner({ scars: { lost: EMPTY_MASK, updatedAt: T0, version: 9 }, balanceMicro: 1 });
    const s = id.store.get();
    expect(s.revision).toBe(r);
    expect(s.identity.mode === "owner" && s.identity.view.pub.scars.version).toBe(9);
  });

  it("ignores a corrupt guest profile", () => {
    localStorage.setItem("pl.guest.v1", "{nope");
    expect(loadGuestProfile()).toEqual({ v: 1, loaner: null, scars: {} });
    localStorage.setItem("pl.guest.v1", JSON.stringify({ v: 1, loaner: null, scars: { "1": { lost: "zz" } } }));
    expect(loadGuestProfile().scars).toEqual({});
  });
});
