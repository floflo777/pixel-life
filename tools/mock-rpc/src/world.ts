import { GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import {
  encodePacked,
  getAddress,
  isAddress,
  keccak256,
  padHex,
  slice,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { loadDesignFriends } from "./design-friends.js";

/** Canonical Multicall3 address (same on every EVM chain, including Robinhood Chain). */
export const MULTICALL3_ADDRESS: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
/** The public Robinhood Chain RPC that the SDK hardcodes; e2e and Node tests redirect it to the mock. */
export const ROBINHOOD_RPC_URL = GENERATION_SPRITE_MANIFEST.rpcUrl;
/** Robinhood Chain mainnet id (0x1237). */
export const ROBINHOOD_CHAIN_ID = GENERATION_SPRITE_MANIFEST.chainId;

/** One Friend placed in the fixture world. Omitted fields are derived deterministically. */
export interface FriendSpec {
  readonly tokenId: bigint;
  readonly owner: Address;
  /** 0 = hidden generation-0 (not hardwired, SDK-ineligible). Defaults to 1. */
  readonly generation?: number;
  readonly familyId?: number;
  readonly seed?: number;
  /** 64 registry bitmaps. Defaults to the design-data frames for this token (or a stand-in). */
  readonly frames?: readonly bigint[];
  readonly tokenBoundAccount?: Address;
}

/** Declarative world description accepted by `new MockWorld()` and `startMockRpc()`. */
export interface WorldSpec {
  readonly chainId?: number;
  /** Head block. Defaults to the Generations transfer start block + 1000. */
  readonly headBlock?: bigint;
  readonly friends?: readonly FriendSpec[];
  /** Native balances in wei. Addresses not listed have 0 (test wallets are never funded). */
  readonly balances?: Readonly<Record<string, bigint>>;
}

/** Resolved on-chain state of one Friend (ownership lives in the Transfer log). */
export interface MockFriend {
  readonly tokenId: bigint;
  readonly generation: number;
  readonly familyId: number;
  readonly seed: number;
  readonly frames: readonly bigint[];
  readonly tokenBoundAccount: Address;
}

/** A Generations Transfer event, the single source of truth for ownership at any block. */
export interface TransferLog {
  readonly blockNumber: bigint;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly from: Address;
  readonly to: Address;
  readonly tokenId: bigint;
}

/** A raw transaction accepted by `eth_sendRawTransaction` (value transfer only, no execution). */
export interface SentTransaction {
  readonly hash: Hex;
  readonly from: Address;
  readonly to: Address | null;
  readonly value: bigint;
  readonly blockNumber: bigint;
}

/** Injected failure. `methods` restricts it to those JSON-RPC methods (default: all). */
export type Fault =
  | {
      readonly kind: "rpc-error";
      readonly code?: number;
      readonly message?: string;
      readonly methods?: readonly string[];
    }
  | { readonly kind: "http-error"; readonly status: number; readonly methods?: readonly string[] };

/** Deterministic fake ERC-6551 account for a token: stable across runs, never a real address. */
export function mockTokenBoundAccount(tokenId: bigint): Address {
  return getAddress(slice(keccak256(encodePacked(["string", "uint256"], ["pl-mock-tba", tokenId])), 12));
}

/** Deterministic block hash for a block number. */
export function mockBlockHash(blockNumber: bigint): Hex {
  return keccak256(encodePacked(["string", "uint256"], ["pl-mock-block", blockNumber]));
}

/** Fills a FriendSpec's defaults from the design data (real frames when the token is in it). */
function resolveFriend(spec: FriendSpec): MockFriend {
  if (spec.tokenId < 1n || spec.tokenId >= 1n << 256n) throw new RangeError(`Invalid token id ${spec.tokenId}.`);
  const design = loadDesignFriends();
  const stand = design.find((d) => d.tokenId === spec.tokenId) ?? design[Number(spec.tokenId % BigInt(design.length))];
  // Invariant: the design data is non-empty, so the modulo index always exists.
  if (!stand) throw new Error("Design Friends data is empty.");
  if (spec.frames && spec.frames.length !== 64) throw new RangeError("A Friend has exactly 64 frames.");
  return {
    tokenId: spec.tokenId,
    generation: spec.generation ?? 1,
    familyId: spec.familyId ?? stand.familyId,
    seed: spec.seed ?? Number(spec.tokenId & 0xffffffffn),
    frames: spec.frames ?? stand.frames,
    tokenBoundAccount: spec.tokenBoundAccount ?? mockTokenBoundAccount(spec.tokenId),
  };
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Mutable fixture chain. Ownership at block N is replayed from Transfer logs, like the real contract. */
export class MockWorld {
  readonly chainId: number;
  readonly generations: Address = GENERATION_SPRITE_MANIFEST.generations;
  readonly registry: Address = GENERATION_SPRITE_MANIFEST.registry;
  readonly transferStartBlock: bigint = GENERATION_SPRITE_MANIFEST.transferStartBlock;
  head: bigint;
  readonly friends = new Map<bigint, MockFriend>();
  readonly transfers: TransferLog[] = [];
  readonly balances = new Map<string, bigint>();
  readonly nonces = new Map<string, number>();
  readonly transactions = new Map<Hex, SentTransaction>();
  /** Every JSON-RPC method received, in order (batch entries individually). */
  readonly requests: string[] = [];
  fault: Fault | null = null;

  constructor(spec: WorldSpec = {}) {
    this.chainId = spec.chainId ?? ROBINHOOD_CHAIN_ID;
    this.head = spec.headBlock ?? this.transferStartBlock + 1000n;
    for (const [address, wei] of Object.entries(spec.balances ?? {})) this.balances.set(address.toLowerCase(), wei);
    (spec.friends ?? []).forEach((friend, index) => {
      if (this.friends.has(friend.tokenId)) throw new Error(`Duplicate fixture Friend #${friend.tokenId}.`);
      this.friends.set(friend.tokenId, resolveFriend(friend));
      // Mint history starts at the canonical first Transfer block, as readOwnedFriends expects.
      this.pushTransfer(zeroAddress, friend.owner, friend.tokenId, this.transferStartBlock + 1n + BigInt(index));
    });
    const last = this.transfers.at(-1);
    if (last && last.blockNumber > this.head) this.head = last.blockNumber;
  }

  private pushTransfer(from: Address, to: Address, tokenId: bigint, blockNumber: bigint): TransferLog {
    if (!isAddress(to)) throw new TypeError(`Invalid recipient ${to}.`);
    const logIndex = this.transfers.filter((t) => t.blockNumber === blockNumber).length;
    const log: TransferLog = {
      blockNumber,
      logIndex,
      transactionHash: keccak256(encodePacked(["string", "uint256", "uint256"], ["pl-mock-tx", blockNumber, tokenId])),
      from: getAddress(from),
      to: getAddress(to),
      tokenId,
    };
    this.transfers.push(log);
    return log;
  }

  /** Current owner at `block` (default head), or null if not minted then. */
  ownerOf(tokenId: bigint, block: bigint = this.head): Address | null {
    let owner: Address | null = null;
    for (const t of this.transfers) if (t.tokenId === tokenId && t.blockNumber <= block) owner = t.to;
    return owner === null || eq(owner, zeroAddress) ? null : owner;
  }

  /** Number of Friends held by `owner` at `block`. */
  balanceOf(owner: Address, block: bigint = this.head): bigint {
    let count = 0n;
    for (const id of this.friends.keys()) {
      const current = this.ownerOf(id, block);
      if (current && eq(current, owner)) count++;
    }
    return count;
  }

  /** Advances the head by `blocks` and returns the new head. */
  mine(blocks = 1n): bigint {
    this.head += blocks;
    return this.head;
  }

  /** Transfers a Friend to `to` in a new block (e.g. to test ownership changes mid-session). */
  transfer(tokenId: bigint, to: Address): TransferLog {
    const from = this.ownerOf(tokenId);
    if (!from) throw new Error(`Friend #${tokenId} is not minted.`);
    return this.pushTransfer(from, to, tokenId, this.mine());
  }

  /** Mints a new Friend to `spec.owner` in a new block. */
  mint(spec: FriendSpec): TransferLog {
    if (this.friends.has(spec.tokenId)) throw new Error(`Friend #${spec.tokenId} already exists.`);
    this.friends.set(spec.tokenId, resolveFriend(spec));
    return this.pushTransfer(zeroAddress, spec.owner, spec.tokenId, this.mine());
  }

  /** Sets or clears (null) the injected fault. */
  setFault(fault: Fault | null): void {
    this.fault = fault;
  }

  /** Native balance in wei. */
  balance(address: string): bigint {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }
}

/** The 32-byte indexed-topic form of an address (as in Transfer log topics). */
export function addressTopic(address: Address): Hex {
  return padHex(address.toLowerCase() as Hex, { size: 32 });
}

/** Options for {@link designWorld}: which real design Friends each owner holds. */
export interface DesignWorldOptions {
  /** owner address → token ids (decimal strings or bigints). */
  readonly owners: Readonly<Record<string, readonly (string | bigint)[]>>;
  /** Token ids that are hidden generation-0 (owned but SDK-ineligible). */
  readonly generationZero?: readonly (string | bigint)[];
  readonly chainId?: number;
  readonly headBlock?: bigint;
  readonly balances?: Readonly<Record<string, bigint>>;
}

/** Builds a WorldSpec from the real design Friends (docs/design/data/friends.json). */
export function designWorld(options: DesignWorldOptions): WorldSpec {
  const gen0 = new Set((options.generationZero ?? []).map((id) => BigInt(id)));
  const friends: FriendSpec[] = [];
  for (const [owner, ids] of Object.entries(options.owners)) {
    if (!isAddress(owner)) throw new TypeError(`Invalid owner ${owner}.`);
    for (const id of ids) {
      const tokenId = BigInt(id);
      friends.push({ tokenId, owner, generation: gen0.has(tokenId) ? 0 : 1 });
    }
  }
  return {
    friends,
    ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
    ...(options.headBlock === undefined ? {} : { headBlock: options.headBlock }),
    ...(options.balances === undefined ? {} : { balances: options.balances }),
  };
}

/** Well-known fixture owners used by the default world and the CLI. */
export const FIXTURE_OWNERS = Object.freeze({
  alice: "0x1111111111111111111111111111111111111111" as Address,
  bob: "0x2222222222222222222222222222222222222222" as Address,
});

/**
 * Default dev/e2e world: every design Friend is minted. `extraOwners` (e.g. a test wallet) get the
 * ids they list, bob gets the next 2 unclaimed, alice the rest (her first is generation-0), so
 * non-owner and gen-0 cases always exist. `generationZero` marks more ids as generation-0.
 */
export function defaultWorldSpec(
  extraOwners: Readonly<Record<string, readonly (string | bigint)[]>> = {},
  generationZero: readonly (string | bigint)[] = [],
): WorldSpec {
  const design = loadDesignFriends().map((f) => f.tokenId.toString());
  const claimed = new Set(Object.values(extraOwners).flatMap((ids) => ids.map(String)));
  const free = design.filter((id) => !claimed.has(id));
  return designWorld({
    owners: {
      ...extraOwners,
      [FIXTURE_OWNERS.bob]: free.slice(0, 2),
      [FIXTURE_OWNERS.alice]: free.slice(2),
    },
    generationZero: [...free.slice(2, 3), ...generationZero],
  });
}
