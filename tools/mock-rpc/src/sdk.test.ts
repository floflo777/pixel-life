/**
 * Conformance of the mock against the real FriendSDK 0.1.4 read paths: if these pass, the SDK
 * (and our server, which calls the same functions) behaves against the mock as against 4663.
 */
import { createFriendReader, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";
import { readOwnedFriends } from "@rarefriends/friendsdk/owned";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDesignFriends } from "./design-friends.js";
import { redirectFetch } from "./fetch-redirect.js";
import { startMockRpc, type MockRpcServer } from "./server.js";
import { designWorld, mockTokenBoundAccount } from "./world.js";

const OWNER = privateKeyToAccount(generatePrivateKey()).address;
const STRANGER: Address = "0x9999999999999999999999999999999999999999";
const MASK = 344030n; // Mask family
const ASYMMETRY = 344033n; // Asymmetry family
const GEN0 = 1969n;

let rpc: MockRpcServer;
let client: PublicClient;

beforeEach(async () => {
  rpc = await startMockRpc({
    world: designWorld({
      owners: { [OWNER]: [MASK, ASYMMETRY, GEN0], [STRANGER]: [63675n] },
      generationZero: [GEN0],
    }),
  });
  client = createPublicClient({ transport: http(rpc.url, { retryCount: 0 }) });
});

afterEach(async () => {
  await rpc.close();
});

describe("readOwnedFriends against the mock", () => {
  it("lists the account's hardwired Friends with canonical wallets and hides generation-0", async () => {
    const result = await readOwnedFriends(client, OWNER);
    expect(result.blockNumber).toBe(rpc.world.head);
    expect(result.hiddenCount).toBe(1);
    expect(result.friends).toEqual([
      { id: MASK, label: `Friend #${MASK}`, kind: "owned", walletAddress: mockTokenBoundAccount(MASK), generation: 1 },
      {
        id: ASYMMETRY,
        label: `Friend #${ASYMMETRY}`,
        kind: "owned",
        walletAddress: mockTokenBoundAccount(ASYMMETRY),
        generation: 1,
      },
    ]);
    // Discovery is owner-filtered log history, never a collection scan.
    expect(rpc.world.requests.filter((m) => m === "eth_getLogs")).toHaveLength(2);
  });

  it("follows transfers out of and back into the account", async () => {
    rpc.world.transfer(MASK, STRANGER);
    let result = await readOwnedFriends(client, OWNER);
    expect(result.friends.map((f) => f.id)).toEqual([ASYMMETRY]);
    rpc.world.transfer(MASK, OWNER);
    result = await readOwnedFriends(client, OWNER);
    expect(result.friends.map((f) => f.id)).toEqual([MASK, ASYMMETRY]);
  });

  it("returns nothing for an account with no Friends", async () => {
    const result = await readOwnedFriends(client, "0x4444444444444444444444444444444444444444");
    expect(result.friends).toEqual([]);
    expect(result.hiddenCount).toBe(0);
  });

  it("surfaces RPC errors instead of an empty list", async () => {
    rpc.world.setFault({ kind: "rpc-error", methods: ["eth_getLogs"], message: "logs unavailable" });
    await expect(readOwnedFriends(client, OWNER)).rejects.toThrow(/Could not load this account's Friend transfers/);
    rpc.world.setFault({ kind: "http-error", status: 503 });
    await expect(readOwnedFriends(client, OWNER)).rejects.toThrow();
  });

  it("works through the SDK's own read client (createFriendReadClient path)", async () => {
    const restore = redirectFetch(rpc.url);
    try {
      const sdkClient = createPublicClient({ transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, { retryCount: 0 }) });
      const result = await readOwnedFriends(sdkClient, OWNER);
      expect(result.friends).toHaveLength(2);
    } finally {
      restore();
    }
  });
});

describe("readGenerationEligibility against the mock", () => {
  it("is eligible for the owner of a hardwired Friend at a fresh block", async () => {
    const result = await readGenerationEligibility(client, MASK, OWNER);
    expect(result).toMatchObject({ owner: OWNER, generation: 1, hardwired: true, ownedByPlayer: true, eligible: true });
    expect(result.blockNumber).toBe(rpc.world.head);
  });

  it("denies a non-owner", async () => {
    const result = await readGenerationEligibility(client, MASK, STRANGER);
    expect(result).toMatchObject({ ownedByPlayer: false, hardwired: true, eligible: false });
  });

  it("denies a generation-0 Friend even to its owner", async () => {
    const result = await readGenerationEligibility(client, GEN0, OWNER);
    expect(result).toMatchObject({ generation: 0, hardwired: false, ownedByPlayer: true, eligible: false });
  });

  it("denies after a transfer (fresh block, not cached)", async () => {
    expect((await readGenerationEligibility(client, MASK, OWNER)).eligible).toBe(true);
    rpc.world.transfer(MASK, STRANGER);
    expect((await readGenerationEligibility(client, MASK, OWNER)).eligible).toBe(false);
  });

  it("throws (never 'eligible') on RPC error, unknown token, or wrong chain", async () => {
    rpc.world.setFault({ kind: "rpc-error", methods: ["eth_call"] });
    await expect(readGenerationEligibility(client, MASK, OWNER)).rejects.toThrow();
    rpc.world.setFault(null);
    await expect(readGenerationEligibility(client, 777n, OWNER)).rejects.toThrow(/ERC721NonexistentToken|revert/);
    const other = await startMockRpc({ world: { chainId: 1, friends: [{ tokenId: MASK, owner: OWNER }] } });
    try {
      const wrongChain = createPublicClient({ transport: http(other.url, { retryCount: 0 }) });
      await expect(readGenerationEligibility(wrongChain, MASK, OWNER)).rejects.toThrow(/requires chain 4663/);
    } finally {
      await other.close();
    }
  });
});

describe("createFriendReader().read() against the mock", () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    restore = redirectFetch(rpc.url);
  });
  afterEach(() => restore());

  it("returns the real design frames and family for a Friend", async () => {
    const design = loadDesignFriends().find((f) => f.tokenId === MASK);
    const sprites = await createFriendReader().read(MASK);
    expect(sprites.familyName).toBe("Mask");
    expect(sprites.familyId).toBe(design?.familyId);
    expect(sprites.frames).toEqual(design?.frames);
    expect(sprites.clips.walk.right).toHaveLength(8);
    expect(sprites.clips.idle.down[0]?.rows).toHaveLength(16);
  });

  it("reads art for every design Friend (public read, no ownership needed)", async () => {
    const reader = createFriendReader();
    for (const friend of [MASK, ASYMMETRY, GEN0, 63675n]) {
      const sprites = await reader.read(friend);
      expect(sprites.frames).toEqual(loadDesignFriends().find((f) => f.tokenId === friend)?.frames);
    }
  });

  it("rejects on RPC error and recovers once the RPC is back", async () => {
    rpc.world.setFault({ kind: "http-error", status: 502 });
    const reader = createFriendReader();
    await expect(reader.read(ASYMMETRY)).rejects.toThrow();
    rpc.world.setFault(null);
    expect((await reader.read(ASYMMETRY)).familyName).toBe("Asymmetry");
  });
});
