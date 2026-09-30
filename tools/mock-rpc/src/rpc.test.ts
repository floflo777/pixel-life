import { FAMILIES_REGISTRY_ABI, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeSpriteRows, loadDesignFriends } from "./design-friends.js";
import { startMockRpc, type MockRpcServer } from "./server.js";
import { defaultWorldSpec, FIXTURE_OWNERS, MULTICALL3_ADDRESS, MockWorld, mockTokenBoundAccount } from "./world.js";

const GENERATIONS_ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
const MOCK_CHAIN = {
  id: 4663,
  name: "Robinhood Chain (mock)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
} as const;
const WALLET_ABI = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (uint256, address, uint256)",
]);

let rpc: MockRpcServer;
let client: PublicClient;

beforeEach(async () => {
  rpc = await startMockRpc({ world: defaultWorldSpec() });
  client = createPublicClient({ transport: http(rpc.url, { retryCount: 0 }) });
});
afterEach(async () => {
  await rpc.close();
});

async function post(body: unknown): Promise<unknown> {
  const response = await fetch(rpc.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

describe("design data", () => {
  it("loads 13 Friends with 64 frames each, bit 0 = top-left", () => {
    const friends = loadDesignFriends();
    expect(friends).toHaveLength(13);
    for (const f of friends) expect(f.frames).toHaveLength(64);
    const rows = Array.from({ length: 16 }, (_, y) => (y === 0 ? "#" + ".".repeat(15) : ".".repeat(15) + "#"));
    expect(encodeSpriteRows(rows) & 1n).toBe(1n);
    expect(encodeSpriteRows(rows) >> 255n).toBe(1n);
  });
});

describe("JSON-RPC surface", () => {
  it("answers chain id, block number, balance and code", async () => {
    expect(await client.getChainId()).toBe(4663);
    expect(await client.getBlockNumber()).toBe(rpc.world.head);
    expect(await client.getBalance({ address: FIXTURE_OWNERS.alice })).toBe(0n);
    expect(await client.getCode({ address: GENERATION_SPRITE_MANIFEST.generations })).toMatch(/^0x60/);
    expect(await client.getCode({ address: FIXTURE_OWNERS.alice })).toBeUndefined();
  });

  it("supports batches, CORS preflight and a GET health check", async () => {
    const batch = (await post([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
      { jsonrpc: "2.0", id: 2, method: "nope" },
    ])) as { id: number; result?: string; error?: { code: number } }[];
    expect(batch[0]?.result).toBe("0x1237");
    expect(batch[1]?.error?.code).toBe(-32601);
    const preflight = await fetch(rpc.url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(await (await fetch(rpc.url)).json()).toMatchObject({ ok: true, chainId: 4663, friends: 13 });
  });

  it("answers historical ownership from the transfer log and rejects future blocks", async () => {
    const [id] = rpc.world.friends.keys();
    if (id === undefined) throw new Error("empty world");
    const before = rpc.world.head;
    const original = rpc.world.ownerOf(id);
    rpc.world.transfer(id, FIXTURE_OWNERS.bob);
    const read = (blockNumber?: bigint) =>
      client.readContract({
        address: GENERATION_SPRITE_MANIFEST.generations,
        abi: GENERATIONS_ABI,
        functionName: "ownerOf",
        args: [id],
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });
    expect(await read(before)).toBe(original);
    expect(await read()).toBe(FIXTURE_OWNERS.bob);
    await expect(read(rpc.world.head + 10n)).rejects.toThrow(/header not found/);
  });

  it("reverts ownerOf for unminted tokens and decodes tokenURI", async () => {
    await expect(
      client.readContract({
        address: GENERATION_SPRITE_MANIFEST.generations,
        abi: GENERATIONS_ABI,
        functionName: "ownerOf",
        args: [1n],
      }),
    ).rejects.toThrow();
    const uri = await client.readContract({
      address: GENERATION_SPRITE_MANIFEST.generations,
      abi: GENERATIONS_ABI,
      functionName: "tokenURI",
      args: [344030n],
    });
    const json = JSON.parse(Buffer.from(uri.split(",")[1] ?? "", "base64").toString()) as { name: string };
    expect(json.name).toBe("Friend #344030");
  });

  it("serves the registry portrait and the token-bound account's owner()/token()", async () => {
    const design = loadDesignFriends()[0];
    if (!design) throw new Error("no design data");
    const seed = Number(design.tokenId & 0xffffffffn);
    const portrait = await client.readContract({
      address: GENERATION_SPRITE_MANIFEST.registry,
      abi: FAMILIES_REGISTRY_ABI,
      functionName: "portrait",
      args: [design.familyId, seed],
    });
    expect(portrait).toBe(design.frames[0]);
    const tba = mockTokenBoundAccount(design.tokenId);
    expect(await client.readContract({ address: tba, abi: WALLET_ABI, functionName: "owner" })).toBe(
      rpc.world.ownerOf(design.tokenId),
    );
    const [chainId, collection, tokenId] = await client.readContract({
      address: tba,
      abi: WALLET_ABI,
      functionName: "token",
    });
    expect([chainId, collection, tokenId]).toEqual([4663n, GENERATION_SPRITE_MANIFEST.generations, design.tokenId]);
  });

  it("aggregates through Multicall3, including allowFailure", async () => {
    const results = await client.multicall({
      multicallAddress: MULTICALL3_ADDRESS,
      contracts: [
        {
          address: GENERATION_SPRITE_MANIFEST.generations,
          abi: GENERATIONS_ABI,
          functionName: "balanceOf",
          args: [FIXTURE_OWNERS.bob],
        },
        { address: GENERATION_SPRITE_MANIFEST.generations, abi: GENERATIONS_ABI, functionName: "ownerOf", args: [1n] },
        {
          address: GENERATION_SPRITE_MANIFEST.registry,
          abi: FAMILIES_REGISTRY_ABI,
          functionName: "familyOf",
          args: [344030n],
        },
      ],
    });
    expect(results[0]).toEqual({ status: "success", result: 2n });
    expect(results[1]?.status).toBe("failure");
    expect(results[2]).toEqual({ status: "success", result: 1 });
  });

  it("enforces the public RPC's 10M-block log range", async () => {
    const response = (await post({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ fromBlock: "0x0", toBlock: `0x${rpc.world.head.toString(16)}` }],
    })) as { error?: { message: string } };
    expect(response.error?.message).toMatch(/max block range/);
  });

  it("verifies SIWE-style personal_sign signatures via viem verifyMessage", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = "Sign in to Pixel Life. No transaction, no cost.";
    const signature = await account.signMessage({ message });
    expect(await client.verifyMessage({ address: account.address, message, signature })).toBe(true);
    expect(await client.verifyMessage({ address: FIXTURE_OWNERS.alice, message, signature })).toBe(false);
  });
});

describe("transactions (minimal)", () => {
  it("rejects sends from an unfunded wallet with insufficient funds", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const wallet = createWalletClient({ account, transport: http(rpc.url, { retryCount: 0 }), chain: MOCK_CHAIN });
    await expect(wallet.sendTransaction({ to: FIXTURE_OWNERS.bob, value: 1n, gas: 21_000n })).rejects.toThrow(
      /insufficient funds/,
    );
  });

  it("accepts a value transfer from a funded wallet and returns a receipt", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const world = new MockWorld({ balances: { [account.address]: parseEther("1") } });
    const funded = await startMockRpc({ world });
    try {
      const transport = http(funded.url, { retryCount: 0 });
      const wallet = createWalletClient({ account, transport, chain: MOCK_CHAIN });
      const pub = createPublicClient({ transport, chain: MOCK_CHAIN });
      const gas = await pub.estimateGas({ account: account.address, to: FIXTURE_OWNERS.bob, value: 5n });
      expect(gas).toBe(21_000n);
      const hash = await wallet.sendTransaction({ to: FIXTURE_OWNERS.bob, value: 5n });
      const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 10 });
      expect(receipt.status).toBe("success");
      expect(await pub.getBalance({ address: FIXTURE_OWNERS.bob })).toBe(5n);
    } finally {
      await funded.close();
    }
  });
});
