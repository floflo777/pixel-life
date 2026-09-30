import { designWorld, mockTokenBoundAccount } from "@pl/mock-rpc";
import { EMPTY_MASK, familyIdFromName, type FriendView } from "@pl/shared";
import { getAddress, type Address } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import {
  cookieFrom,
  newWallet,
  signIn,
  signedSiwe,
  startHarness,
  type Harness,
  type HarnessOptions,
} from "../test/harness.js";

const MASK = 344030n;
const ASYMMETRY = 344033n;
const GEN0 = 1969n;
const STRANGERS = 63675n;
const STRANGER: Address = "0x9999999999999999999999999999999999999999";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function start(owner: Address, options: HarnessOptions = {}): Promise<Harness> {
  h = await startHarness({
    world: designWorld({
      owners: { [owner]: [MASK, ASYMMETRY, GEN0], [STRANGER]: [STRANGERS] },
      generationZero: [GEN0],
    }),
    ...options,
  });
  return h;
}

const verify = (harness: Harness, body: object, cookie?: string) =>
  harness.app.inject({
    method: "POST",
    url: "/api/auth/verify",
    headers: { ...harness.edge, ...(cookie ? { cookie } : {}) },
    payload: body,
  });

const bindFriend = (harness: Harness, cookie: string, tokenId: bigint | string) =>
  harness.app.inject({
    method: "POST",
    url: "/api/session/friend",
    headers: { ...harness.edge, cookie },
    payload: { tokenId: tokenId.toString() },
  });

describe("SIWE sign-in", () => {
  it("issues a nonce, verifies the signature and sets an HttpOnly session cookie", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const { message, signature } = await signedSiwe(harness, wallet);
    const response = await verify(harness, { message, signature });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ address: getAddress(wallet.address) });
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toMatch(/^pl_sess=/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${7 * 86_400}`);
  });

  it("refuses a replayed nonce", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const signed = await signedSiwe(harness, wallet);
    expect((await verify(harness, signed)).statusCode).toBe(200);
    const replay = await verify(harness, signed);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ error: "unauthorized", reason: "invalid_nonce" });
  });

  it("lets exactly one of two concurrent replays win", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const signed = await signedSiwe(harness, wallet);
    const results = await Promise.all([verify(harness, signed), verify(harness, signed), verify(harness, signed)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401, 401]);
  });

  it("refuses a nonce the server never issued", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const signed = await signedSiwe(harness, wallet, { nonce: "abcdefabcdefabcdefabcdefabcdef12" });
    expect((await verify(harness, signed)).json()).toMatchObject({ error: "unauthorized", reason: "invalid_nonce" });
  });

  it("refuses a message for another domain or URI", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const wrongDomain = await verify(harness, await signedSiwe(harness, wallet, { domain: "evil.example" }));
    expect(wrongDomain.statusCode).toBe(401);
    expect(wrongDomain.json()).toMatchObject({ error: "unauthorized", reason: "wrong_domain" });
    const wrongUri = await verify(harness, await signedSiwe(harness, wallet, { uri: "https://evil.example" }));
    expect(wrongUri.json()).toMatchObject({ error: "unauthorized", reason: "wrong_domain" });
  });

  it("refuses a message for another chain", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const response = await verify(harness, await signedSiwe(harness, wallet, { chainId: 1 }));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized", reason: "wrong_chain" });
  });

  it("refuses an expired message and an expired nonce", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const now = harness.clock.now();
    const expired = await signedSiwe(harness, wallet, {
      issuedAt: new Date(now.getTime() - 120_000),
      expirationTime: new Date(now.getTime() - 1_000),
    });
    expect((await verify(harness, expired)).json()).toMatchObject({ error: "unauthorized", reason: "expired" });

    const signed = await signedSiwe(harness, wallet, { expirationTime: new Date(now.getTime() + 60 * 60_000) });
    harness.clock.advance(6 * 60_000); // nonce TTL is 5 min
    const late = await verify(harness, signed);
    expect(late.statusCode).toBe(401);
    expect(late.json()).toMatchObject({ error: "unauthorized", reason: "invalid_nonce" });
  });

  it("refuses a signature from another key without burning the nonce", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const signed = await signedSiwe(harness, wallet);
    const forged = await newWallet().signMessage({ message: signed.message });
    const response = await verify(harness, { message: signed.message, signature: forged });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized", reason: "bad_signature" });
    expect((await verify(harness, signed)).statusCode).toBe(200);
  });

  it("delegates to viem verifyMessage, so EIP-1271 smart wallets can sign in", async () => {
    const contractWallet: Address = "0x5555555555555555555555555555555555555555";
    const signer = newWallet();
    const calls: Address[] = [];
    const harness = await start(signer.address, {
      wrapChain: (client) => ({
        ...client,
        // Stands in for the on-chain isValidSignature call viem makes for contract accounts.
        verifyMessage: async (args) => {
          calls.push(args.address);
          return args.address === contractWallet;
        },
      }),
    });
    const signed = await signedSiwe(harness, signer, { address: contractWallet });
    const response = await verify(harness, signed);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ address: contractWallet });
    expect(calls).toEqual([contractWallet]);
  });

  it("answers 503 (not 401) when signature verification cannot reach the chain", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address, {
      wrapChain: (client) => ({
        ...client,
        verifyMessage: async () => {
          throw new Error("rpc down");
        },
      }),
    });
    const response = await verify(harness, await signedSiwe(harness, wallet));
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "internal", reason: "rpc_error" });
  });

  it("rejects malformed bodies", async () => {
    const harness = await start(newWallet().address);
    expect((await verify(harness, { message: "hello", signature: "0x00" })).json()).toMatchObject({
      error: "bad_request",
      reason: "invalid_message",
    });
    expect((await verify(harness, { message: "hello" })).statusCode).toBe(400);
  });
});

describe("sessions", () => {
  it("logout revokes the session server-side, so the old cookie stops working", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    expect((await bindFriend(harness, cookie, MASK)).statusCode).toBe(200);
    const logout = await harness.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { ...harness.edge, cookie },
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ ok: true });
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    const after = await bindFriend(harness, cookie, MASK);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: "unauthorized", reason: "no_session" });
  });

  it("rejects a tampered or expired session cookie", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    const tampered = cookie.slice(0, -3) + (cookie.endsWith("AAA") ? "BBB" : "AAA");
    expect((await bindFriend(harness, tampered, MASK)).statusCode).toBe(401);
    harness.clock.advance(7 * 86_400_000 + 1_000);
    expect((await bindFriend(harness, cookie, MASK)).statusCode).toBe(401);
  });

  it("rotates: signing in again revokes the previous session", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const first = await signIn(harness, wallet);
    const signed = await signedSiwe(harness, wallet);
    const second = await verify(harness, signed, first);
    expect(second.statusCode).toBe(200);
    expect((await bindFriend(harness, first, MASK)).statusCode).toBe(401);
    expect((await bindFriend(harness, cookieFrom(second, "pl_sess"), MASK)).statusCode).toBe(200);
  });
});

describe("POST /api/session/friend (fresh-block eligibility)", () => {
  it("binds an owned hardwired Friend (TBA read at the eligibility block) and returns its FriendView", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    const response = await bindFriend(harness, cookie, MASK);
    expect(response.statusCode).toBe(200);
    const view = response.json() as FriendView;
    expect(view.loaned).toBe(false);
    expect(view.appearance).toMatchObject({ tokenId: MASK.toString(), familyId: familyIdFromName("Mask") });
    expect(view.appearance.frames).toHaveLength(64);
    expect(view.pub).toMatchObject({
      tokenId: MASK.toString(),
      scars: { lost: EMPTY_MASK, version: 0, updatedAt: harness.clock.now().getTime() },
      goldHeld: 0,
      economy: "sim",
    });
    const binding = await harness.db.kysely.selectFrom("friend_bindings").selectAll().executeTakeFirstOrThrow();
    expect(binding).toMatchObject({
      token_id: MASK.toString(),
      address: wallet.address.toLowerCase(),
      tba: mockTokenBoundAccount(MASK).toLowerCase(),
      block: Number(harness.rpc.world.head),
    });
    const friend = await harness.db.kysely.selectFrom("friends").selectAll().executeTakeFirstOrThrow();
    expect(friend).toMatchObject({ token_id: MASK.toString(), last_owner: wallet.address.toLowerCase() });
  });

  it("denies a Friend owned by someone else", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const response = await bindFriend(harness, await signIn(harness, wallet), STRANGERS);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "not_owner" });
  });

  it("denies a hidden generation-0 Friend", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const response = await bindFriend(harness, await signIn(harness, wallet), GEN0);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "not_owner", reason: "not_hardwired" });
  });

  it("denies an unminted token (ownerOf reverts)", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const response = await bindFriend(harness, await signIn(harness, wallet), 424242n);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "not_owner" });
  });

  it("answers 503 on RPC failure and never binds", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    harness.rpc.world.setFault({ kind: "http-error", status: 502 });
    const response = await bindFriend(harness, cookie, MASK);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "internal", reason: "rpc_error" });
    expect(await harness.db.kysely.selectFrom("friend_bindings").selectAll().execute()).toEqual([]);
  });

  it("denies when the chain is not 4663", async () => {
    const wallet = newWallet();
    h = await startHarness({ world: designWorld({ owners: { [wallet.address]: [MASK] }, chainId: 1 }) });
    const response = await bindFriend(h, await signIn(h, wallet), MASK);
    expect(response.statusCode).toBe(503);
  });

  it("drops the previous binding when a re-pick is denied", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    expect((await bindFriend(harness, cookie, MASK)).statusCode).toBe(200);
    harness.rpc.world.transfer(ASYMMETRY, STRANGER);
    expect((await bindFriend(harness, cookie, ASYMMETRY)).statusCode).toBe(403);
    expect(await harness.db.kysely.selectFrom("friend_bindings").selectAll().execute()).toEqual([]);
  });

  it("validates the token id and requires a session", async () => {
    const wallet = newWallet();
    const harness = await start(wallet.address);
    const cookie = await signIn(harness, wallet);
    expect((await bindFriend(harness, cookie, "0")).statusCode).toBe(400);
    expect((await bindFriend(harness, cookie, "12abc")).statusCode).toBe(400);
    expect((await bindFriend(harness, cookie, "1".repeat(79))).statusCode).toBe(400);
    const anonymous = await harness.app.inject({
      method: "POST",
      url: "/api/session/friend",
      headers: harness.edge,
      payload: { tokenId: "1" },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe("POST /api/guest", () => {
  it("issues a signed guest cookie once and returns the same id while it is valid", async () => {
    const harness = await start(newWallet().address);
    const first = await harness.app.inject({ method: "POST", url: "/api/guest", headers: harness.edge });
    expect(first.statusCode).toBe(200);
    const { guestId } = first.json() as { guestId: string };
    expect(guestId).toMatch(/^g_/);
    const cookie = cookieFrom(first, "pl_guest");
    const again = await harness.app.inject({ method: "POST", url: "/api/guest", headers: { ...harness.edge, cookie } });
    expect(again.json()).toMatchObject({ guestId });
    expect(again.headers["set-cookie"]).toBeUndefined();
  });

  it("does not accept a guest token as a session", async () => {
    const harness = await start(newWallet().address);
    const first = await harness.app.inject({ method: "POST", url: "/api/guest", headers: harness.edge });
    const forged = cookieFrom(first, "pl_guest").replace("pl_guest=", "pl_sess=");
    expect((await bindFriend(harness, forged, MASK)).statusCode).toBe(401);
  });
});
