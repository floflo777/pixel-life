/** Test fixtures for the web shell: real loaners, fake wallet sessions and a scripted API. */
import loanersJson from "@pl/assets/loaners.json";
import { parseLoaners } from "@pl/assets";
import type { FriendView, MeRes } from "@pl/shared";
import type { FriendWalletSnapshot } from "@rarefriends/friendsdk/wallet";
import { vi } from "vitest";
import type { WalletSessionLike } from "../identity/owner-flow.js";

/** The 12 baked loaners. */
export const LOANERS = parseLoaners(loanersJson);

/** First loaner (Mismir #344030). */
export function loaner(i = 0) {
  const l = LOANERS[i];
  if (!l) throw new Error("no loaner");
  return l;
}

/** An owner's `FriendView` built from a loaner's art (tests only). */
export function ownedView(tokenId = "344030", lost = "0".repeat(64)): FriendView {
  const l = LOANERS.find((x) => x.appearance.tokenId === tokenId) ?? loaner();
  return {
    appearance: { ...l.appearance, tokenId },
    loaned: false,
    pub: {
      tokenId,
      scars: { lost, updatedAt: 1_800_000_000_000, version: 1 },
      goldHeld: 0,
      glowCracks: 0,
      streak: 4,
      lastSeen: 1_800_000_000_000,
      economy: "sim",
    },
  };
}

export const ACCOUNT = "0x00000000000000000000000000000000000000aa" as const;
export const OTHER = "0x00000000000000000000000000000000000000bb" as const;

/** A controllable fake of the SDK wallet session. */
export function fakeSession(initial: Partial<FriendWalletSnapshot> = {}) {
  let snap: FriendWalletSnapshot = {
    status: "disconnected",
    wallets: [{ id: "test", name: "Test Wallet" }],
    selectedWalletId: null,
    account: null,
    chainId: null,
    revision: 0,
    error: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const provider = { request: vi.fn(async () => "0xdeadbeef" as unknown) };
  const emit = (patch: Partial<FriendWalletSnapshot>): void => {
    snap = { ...snap, ...patch, revision: snap.revision + 1 };
    for (const l of [...listeners]) l();
  };
  const session: WalletSessionLike = {
    getSnapshot: () => snap,
    getProvider: () => provider,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    connect: vi.fn(async () => {
      emit({ status: "connected", account: ACCOUNT, chainId: 4663, selectedWalletId: "test" });
      return snap;
    }),
    refresh: vi.fn(async () => snap),
    switchNetwork: vi.fn(async () => {
      emit({ status: "connected", chainId: 4663 });
      return snap;
    }),
    disconnect: vi.fn(() => emit({ status: "disconnected", account: null, chainId: null })),
    dispose: vi.fn(),
  };
  return { session, provider, emit, snap: () => snap };
}

/** A scripted API with `vi.fn` methods (only the ones the flows use). */
export function fakeApi() {
  const me: MeRes = { identity: { kind: "anon" }, friend: null, balanceMicro: null, unread: 0, economy: "sim" };
  const api = {
    nonce: vi.fn(async () => ({ nonce: "abcdef0123456789abcdef0123456789" })),
    verify: vi.fn(async () => ({ address: ACCOUNT })),
    bindFriend: vi.fn(async (tokenId: string) => ownedView(tokenId)),
    unbindFriend: vi.fn(async () => ({ ok: true as const })),
    me: vi.fn(async () => me),
    logout: vi.fn(async () => ({ ok: true as const })),
    guest: vi.fn(async () => ({ guestId: "g1" })),
  };
  return api;
}

/** Waits for pending promise callbacks. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
