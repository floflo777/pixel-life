import { parseSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../api/client.js";
import { ACCOUNT, fakeApi, fakeSession, flush, loaner, OTHER } from "../test/fixtures.js";
import { createOwnerFlow, type Eligibility, ineligibleMessage, type OwnerFlowDeps } from "./owner-flow.js";
import { createIdentity } from "./store.js";

const eligible: Eligibility = {
  generation: 3,
  hardwired: true,
  ownedByPlayer: true,
  eligible: true,
  blockNumber: 100n,
};
const owned = [
  { id: 344030n, label: "Friend #344030", kind: "owned" as const, walletAddress: ACCOUNT, generation: 3 },
  { id: 344033n, label: "Friend #344033", kind: "owned" as const, walletAddress: ACCOUNT, generation: 2 },
];

function setup(over: Partial<OwnerFlowDeps> = {}, sessionInit = {}) {
  const w = fakeSession(sessionInit);
  const api = fakeApi();
  const identity = createIdentity({ now: () => 1_800_000_000_000 });
  identity.startGuest(loaner());
  const readOwnedFriends = vi.fn(async () => ({ friends: owned, blockNumber: 99n, hiddenCount: 1 }));
  const readGenerationEligibility = vi.fn(async () => eligible);
  const flow = createOwnerFlow({
    session: w.session,
    publicClient: {} as OwnerFlowDeps["publicClient"],
    readOwnedFriends,
    readGenerationEligibility,
    api,
    identity,
    origin: "https://pixel-life.test",
    now: () => new Date("2026-10-01T12:00:00Z"),
    ...over,
  });
  return { flow, w, api, identity, readOwnedFriends, readGenerationEligibility };
}

describe("owner flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("connect → discover → pick → fresh gate → SIWE → bind makes the owner identity", async () => {
    const t = setup();
    await t.flow.connect();
    await flush();
    expect(t.flow.store.get().flow).toEqual({ step: "picking" });
    expect(t.flow.store.get().friends).toHaveLength(2);
    expect(t.flow.store.get().hiddenCount).toBe(1);

    const rev = t.identity.store.get().revision;
    await t.flow.select("344033");
    expect(t.readGenerationEligibility).toHaveBeenCalledWith(expect.anything(), 344033n, ACCOUNT);
    // SIWE: a personal_sign of an EIP-4361 message for our host, chain 4663, the server nonce.
    const call = t.w.provider.request.mock.calls[0] as unknown as [{ method: string; params: [string, string] }];
    expect(call[0].method).toBe("personal_sign");
    const [message] = t.api.verify.mock.calls[0] as unknown as [string, string];
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({
      domain: "pixel-life.test",
      chainId: 4663,
      nonce: "abcdef0123456789abcdef0123456789",
    });
    expect(parsed.address?.toLowerCase()).toBe(ACCOUNT);
    expect(message).toContain("No transaction, no cost.");
    expect(t.api.bindFriend).toHaveBeenCalledWith("344033");

    const id = t.identity.store.get();
    expect(id.identity.mode).toBe("owner");
    expect(id.identity.mode === "owner" && id.identity.view.appearance.tokenId).toBe("344033");
    expect(id.revision).toBeGreaterThan(rev);
    expect(t.flow.store.get().flow).toEqual({ step: "bound", tokenId: "344033" });
  });

  it("reuses an existing server session for the same account (no second signature)", async () => {
    const t = setup();
    t.api.me.mockResolvedValue({
      identity: { kind: "owner", address: ACCOUNT },
      friend: null,
      balanceMicro: null,
      unread: 0,
      economy: "sim",
    });
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    expect(t.w.provider.request).not.toHaveBeenCalled();
    expect(t.api.verify).not.toHaveBeenCalled();
    expect(t.identity.store.get().identity.mode).toBe("owner");
  });

  it("stops at wrong chain and resumes discovery after switching", async () => {
    const t = setup();
    (t.w.session.connect as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      t.w.emit({ status: "wrong-network", account: ACCOUNT, chainId: 1 });
      return t.w.snap();
    });
    await t.flow.connect();
    await flush();
    expect(t.flow.store.get().flow).toEqual({ step: "wrong-chain" });
    expect(t.readOwnedFriends).not.toHaveBeenCalled();
    await t.flow.switchNetwork();
    await flush();
    expect(t.flow.store.get().flow).toEqual({ step: "picking" });
  });

  it("refuses a Friend the account does not own, without signing", async () => {
    const t = setup({
      readGenerationEligibility: vi.fn(async () => ({ ...eligible, ownedByPlayer: false, eligible: false })),
    });
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    const f = t.flow.store.get().flow;
    expect(f).toMatchObject({ step: "error", at: "check", tokenId: "344030" });
    expect(f.step === "error" && f.message).toMatch(/doesn't own #344030/);
    expect(t.api.verify).not.toHaveBeenCalled();
    expect(t.identity.store.get().identity.mode).toBe("guest");
  });

  it("explains generation-0 Friends", () => {
    expect(ineligibleMessage("1", { ...eligible, hardwired: false, eligible: false })).toMatch(/generation-0/);
  });

  it("surfaces the server's fresh-block refusal (not_owner) and lets the player retry", async () => {
    const t = setup();
    t.api.bindFriend.mockRejectedValueOnce(new ApiRequestError(403, "not_owner", "no"));
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    expect(t.flow.store.get().flow).toMatchObject({ step: "error", at: "bind" });
    expect(t.identity.store.get().identity.mode).toBe("guest");
    await t.flow.retry();
    expect(t.flow.store.get().flow).toEqual({ step: "bound", tokenId: "344030" });
  });

  it("reports a cancelled signature plainly", async () => {
    const t = setup();
    t.w.provider.request.mockRejectedValueOnce(Object.assign(new Error("User rejected"), { code: 4001 }));
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    expect(t.flow.store.get().flow).toMatchObject({
      step: "error",
      at: "sign",
      message: "Signature cancelled. Nothing was sent.",
    });
  });

  it("drops the bound Friend when the wallet switches account, then rediscovers", async () => {
    const t = setup();
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    const rev = t.identity.store.get().revision;
    t.w.emit({ account: OTHER });
    await flush();
    const id = t.identity.store.get();
    expect(id.identity.mode).toBe("guest");
    expect(id.revision).toBeGreaterThan(rev);
    expect(id.notice).toMatch(/changed/);
    expect(t.api.unbindFriend).toHaveBeenCalled();
    expect(t.readOwnedFriends).toHaveBeenLastCalledWith(expect.anything(), OTHER);
  });

  it("handles the SDK's two-phase re-read on accountsChanged (connecting, then the new account)", async () => {
    const t = setup();
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    t.w.reread({ status: "connected", account: OTHER, chainId: 4663 });
    await flush();
    expect(t.identity.store.get().identity.mode).toBe("guest");
    expect(t.identity.store.get().notice).toMatch(/changed/);
    expect(t.readOwnedFriends).toHaveBeenLastCalledWith(expect.anything(), OTHER);
  });

  it("drops the bound Friend when the chain changes", async () => {
    const t = setup();
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    t.w.emit({ status: "wrong-network", chainId: 1 });
    await flush();
    expect(t.identity.store.get().identity.mode).toBe("guest");
    expect(t.flow.store.get().flow).toEqual({ step: "wrong-chain" });
  });

  it("aborts a check that raced with an account change", async () => {
    let release: (e: Eligibility) => void = () => undefined;
    const t = setup({
      readGenerationEligibility: vi.fn(() => new Promise<Eligibility>((r) => (release = r))),
    });
    await t.flow.connect();
    await flush();
    const pending = t.flow.select("344030");
    t.w.emit({ account: OTHER });
    release(eligible);
    await pending;
    await flush();
    expect(t.api.bindFriend).not.toHaveBeenCalled();
    expect(t.identity.store.get().identity.mode).toBe("guest");
  });

  it("keeps a server-restored owner while the wallet is merely not connected yet", async () => {
    const t = setup();
    t.identity.setOwner(ACCOUNT, (await t.api.bindFriend("344030")) as never);
    t.w.emit({ status: "connecting" });
    t.w.emit({ status: "connected", account: ACCOUNT, chainId: 4663 });
    await flush();
    expect(t.identity.store.get().identity.mode).toBe("owner");
    expect(t.flow.store.get().flow).toEqual({ step: "bound", tokenId: "344030" });
  });

  it("shows the empty state when the wallet owns no playable Friend", async () => {
    const t = setup({ readOwnedFriends: vi.fn(async () => ({ friends: [], blockNumber: 1n, hiddenCount: 2 })) });
    await t.flow.connect();
    await flush();
    expect(t.flow.store.get().flow).toEqual({ step: "empty" });
    expect(t.flow.store.get().hiddenCount).toBe(2);
  });

  it("reports discovery failures with a retry", async () => {
    const readOwnedFriends = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC down"))
      .mockResolvedValue({ friends: owned, blockNumber: 1n, hiddenCount: 0 });
    const t = setup({ readOwnedFriends });
    await t.flow.connect();
    await flush();
    expect(t.flow.store.get().flow).toMatchObject({ step: "error", at: "discover" });
    await t.flow.retry();
    expect(t.flow.store.get().flow).toEqual({ step: "picking" });
  });

  it("disconnect signs out of the server and falls back to the loaner", async () => {
    const t = setup();
    await t.flow.connect();
    await flush();
    await t.flow.select("344030");
    await t.flow.disconnect();
    expect(t.api.logout).toHaveBeenCalled();
    expect(t.identity.store.get().identity.mode).toBe("guest");
    expect(t.flow.store.get().flow).toEqual({ step: "idle" });
  });
});
