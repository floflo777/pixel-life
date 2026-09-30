import { FAMILIES_REGISTRY_ABI, GENERATION_FAMILY_NAMES } from "@rarefriends/friendsdk/sprites";
import {
  decodeFunctionData,
  encodeErrorResult,
  encodeFunctionResult,
  isAddress,
  isHex,
  keccak256,
  numberToHex,
  parseAbi,
  parseTransaction,
  recoverTransactionAddress,
  toEventSelector,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type ContractFunctionReturnType,
  type DecodeFunctionDataReturnType,
  type Hex,
} from "viem";
import { MULTICALL3_ADDRESS, addressTopic, mockBlockHash, type MockWorld, type TransferLog } from "./world.js";

/** A JSON-RPC 2.0 request as received on the wire. */
export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: readonly unknown[];
}

/** A JSON-RPC 2.0 response: exactly one of `result` / `error`. */
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

/** A JSON-RPC error with a standard code; revert data travels in `data`, as viem expects. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Hex,
  ) {
    super(message);
  }
}

/** Robinhood's public RPC rejects log queries over this many inclusive blocks; the SDK pages by it. */
export const MAX_LOG_BLOCK_RANGE = 10_000_000n;
/** Fixed gas price (wei) reported by the mock: 0.01 gwei, like an Arbitrum Orbit chain at rest. */
export const MOCK_GAS_PRICE = 10_000_000n;
/** Timestamp of block 0; each block adds 1 s (only needs to be monotonic). */
const GENESIS_TIMESTAMP = 1_700_000_000n;

const GENERATIONS_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "error ERC721NonexistentToken(uint256 tokenId)",
  "function balanceOf(address account) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function generation(uint256 tokenId) view returns (uint8)",
  "function tokenBoundAccount(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);
const FRIEND_WALLET_ABI = parseAbi([
  "function owner() view returns (address)",
  "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)",
]);
const MULTICALL3_ABI = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
  "function getChainId() view returns (uint256 chainid)",
]);
const ERROR_STRING_ABI = parseAbi(["error Error(string)"]);
/** Transfer(address,address,uint256) topic0. */
export const TRANSFER_TOPIC = toEventSelector("Transfer(address,address,uint256)");
type Frames64 = ContractFunctionReturnType<typeof FAMILIES_REGISTRY_ABI, "view", "frames">;
const FAKE_CODE: Hex = "0x6080604052";

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hex = (value: bigint | number) => numberToHex(value);

/** An eth_call revert, surfaced as JSON-RPC code 3 with the encoded reason. */
function revert(data: Hex = "0x", reason = "execution reverted"): never {
  throw new RpcError(3, reason, data);
}

function revertString(reason: string): never {
  revert(
    encodeErrorResult({ abi: ERROR_STRING_ABI, errorName: "Error", args: [reason] }),
    `execution reverted: ${reason}`,
  );
}

/** Resolves a block tag/number param to a concrete block number, rejecting future blocks. */
function blockParam(world: MockWorld, tag: unknown): bigint {
  if (
    tag === undefined ||
    tag === null ||
    tag === "latest" ||
    tag === "pending" ||
    tag === "safe" ||
    tag === "finalized"
  )
    return world.head;
  if (tag === "earliest") return 0n;
  if (typeof tag === "object" && "blockNumber" in tag)
    return blockParam(world, (tag as { blockNumber: unknown }).blockNumber);
  if (typeof tag === "string" && isHex(tag)) {
    const n = BigInt(tag);
    if (n > world.head) throw new RpcError(-32000, "header not found");
    return n;
  }
  throw new RpcError(-32602, `invalid block tag ${String(tag)}`);
}

function decode<const abi extends Abi>(abi: abi, data: Hex): DecodeFunctionDataReturnType<abi> {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return revert();
  }
}

/** Executes a read against the fixture contracts at `block`. Returns ABI-encoded return data. */
function call(world: MockWorld, to: Address | undefined, data: Hex, block: bigint): Hex {
  // Deployless calls (viem's ERC-6492 verifier) revert, so viem falls back to ECDSA recovery.
  if (!to) return revert();
  if (eq(to, world.generations)) return callGenerations(world, data, block);
  if (eq(to, world.registry)) return callRegistry(world, data);
  if (eq(to, MULTICALL3_ADDRESS)) return callMulticall(world, data, block);
  const friend = [...world.friends.values()].find((f) => eq(f.tokenBoundAccount, to));
  if (friend) {
    const { functionName } = decode(FRIEND_WALLET_ABI, data);
    if (functionName === "owner")
      return encodeFunctionResult({
        abi: FRIEND_WALLET_ABI,
        functionName,
        result: world.ownerOf(friend.tokenId, block) ?? zeroAddress,
      });
    return encodeFunctionResult({
      abi: FRIEND_WALLET_ABI,
      functionName,
      result: [BigInt(world.chainId), world.generations, friend.tokenId],
    });
  }
  // A call to an address with no code succeeds with empty data, as on a real EVM.
  return "0x";
}

function callGenerations(world: MockWorld, data: Hex, block: bigint): Hex {
  const decoded = decode(GENERATIONS_ABI, data);
  const nonexistent = (tokenId: bigint) =>
    revert(encodeErrorResult({ abi: GENERATIONS_ABI, errorName: "ERC721NonexistentToken", args: [tokenId] }));
  const existing = (tokenId: bigint) => {
    const friend = world.friends.get(tokenId);
    const owner = world.ownerOf(tokenId, block);
    if (!friend || !owner) return nonexistent(tokenId);
    return { friend, owner };
  };
  switch (decoded.functionName) {
    case "balanceOf": {
      const [account] = decoded.args;
      if (eq(account, zeroAddress)) return revertString("ERC721: address zero is not a valid owner");
      return encodeFunctionResult({
        abi: GENERATIONS_ABI,
        functionName: "balanceOf",
        result: world.balanceOf(account, block),
      });
    }
    case "ownerOf":
      return encodeFunctionResult({
        abi: GENERATIONS_ABI,
        functionName: "ownerOf",
        result: existing(decoded.args[0]).owner,
      });
    case "generation":
      return encodeFunctionResult({
        abi: GENERATIONS_ABI,
        functionName: "generation",
        result: existing(decoded.args[0]).friend.generation,
      });
    case "tokenBoundAccount":
      return encodeFunctionResult({
        abi: GENERATIONS_ABI,
        functionName: "tokenBoundAccount",
        result: existing(decoded.args[0]).friend.tokenBoundAccount,
      });
    case "tokenURI": {
      const { friend } = existing(decoded.args[0]);
      const json = JSON.stringify({
        name: `Friend #${friend.tokenId}`,
        description: "Pixel Life mock RPC fixture",
        attributes: [
          { trait_type: "Family", value: GENERATION_FAMILY_NAMES[friend.familyId] ?? "Unknown" },
          { trait_type: "Generation", value: friend.generation },
        ],
      });
      return encodeFunctionResult({
        abi: GENERATIONS_ABI,
        functionName: "tokenURI",
        result: `data:application/json;base64,${Buffer.from(json).toString("base64")}`,
      });
    }
    case "name":
      return encodeFunctionResult({ abi: GENERATIONS_ABI, functionName: "name", result: "Rare Friends Generations" });
    case "symbol":
      return encodeFunctionResult({ abi: GENERATIONS_ABI, functionName: "symbol", result: "FRIEND" });
    case "supportsInterface": {
      // ERC-165 and ERC-721 only.
      const supported = ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f"].includes(decoded.args[0].toLowerCase());
      return encodeFunctionResult({ abi: GENERATIONS_ABI, functionName: "supportsInterface", result: supported });
    }
  }
}

function framesFor(world: MockWorld, familyId: number, seed: number): readonly bigint[] {
  const exact = [...world.friends.values()].find((f) => f.familyId === familyId && f.seed === seed);
  if (exact) return exact.frames;
  // The real registry renders any (family, seed); the mock reuses a same-family Friend's art.
  const sibling = [...world.friends.values()].find((f) => f.familyId === familyId);
  if (sibling) return sibling.frames;
  return revertString("mock registry: unknown family/seed");
}

function callRegistry(world: MockWorld, data: Hex): Hex {
  const decoded = decode(FAMILIES_REGISTRY_ABI, data);
  const familyCheck = (id: number) => {
    if (id >= GENERATION_FAMILY_NAMES.length) revertString("unknown family");
    return id;
  };
  switch (decoded.functionName) {
    case "familyOf": {
      const [tokenId] = decoded.args;
      const friend = world.friends.get(tokenId);
      const result = friend?.familyId ?? Number(tokenId % BigInt(GENERATION_FAMILY_NAMES.length));
      return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", result });
    }
    case "seedOf": {
      const [tokenId] = decoded.args;
      const result = world.friends.get(tokenId)?.seed ?? Number(tokenId & 0xffffffffn);
      return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", result });
    }
    case "familyName": {
      const name = GENERATION_FAMILY_NAMES[familyCheck(decoded.args[0])] ?? "";
      return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "familyName", result: name });
    }
    case "module":
      familyCheck(decoded.args[0]);
      return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "module", result: zeroAddress });
    case "portrait": {
      const [id, seed] = decoded.args;
      const first = framesFor(world, familyCheck(id), seed)[0] ?? 0n;
      return encodeFunctionResult({ abi: FAMILIES_REGISTRY_ABI, functionName: "portrait", result: first });
    }
    case "frames":
    case "sceneFrames": {
      const [id, seed] = decoded.args;
      const frames = framesFor(world, familyCheck(id), seed);
      return encodeFunctionResult({
        abi: FAMILIES_REGISTRY_ABI,
        functionName: decoded.functionName,
        // Invariant: MockWorld rejects frame sets that are not exactly 64 long.
        result: frames as unknown as Frames64,
      });
    }
  }
}

function callMulticall(world: MockWorld, data: Hex, block: bigint): Hex {
  const decoded = decode(MULTICALL3_ABI, data);
  switch (decoded.functionName) {
    case "aggregate3": {
      const results = decoded.args[0].map(({ target, allowFailure, callData }) => {
        try {
          return { success: true, returnData: call(world, target, callData, block) };
        } catch (error) {
          if (!(error instanceof RpcError) || error.code !== 3) throw error;
          if (!allowFailure) revertString("Multicall3: call failed");
          return { success: false, returnData: error.data ?? "0x" };
        }
      });
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", result: results });
    }
    case "getBlockNumber":
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getBlockNumber", result: block });
    case "getEthBalance":
      return encodeFunctionResult({
        abi: MULTICALL3_ABI,
        functionName: "getEthBalance",
        result: world.balance(decoded.args[0]),
      });
    case "getChainId":
      return encodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "getChainId", result: BigInt(world.chainId) });
  }
}

function formatLog(world: MockWorld, log: TransferLog) {
  return {
    address: world.generations,
    topics: [TRANSFER_TOPIC, addressTopic(log.from), addressTopic(log.to), toHex(log.tokenId, { size: 32 })],
    data: "0x",
    blockNumber: hex(log.blockNumber),
    blockHash: mockBlockHash(log.blockNumber),
    transactionHash: log.transactionHash,
    transactionIndex: "0x0",
    logIndex: hex(log.logIndex),
    removed: false,
  };
}

/** Matches one topic position: null/undefined = wildcard, array = OR. */
function topicMatches(filter: unknown, actual: Hex | undefined): boolean {
  if (filter === null || filter === undefined) return true;
  if (actual === undefined) return false;
  if (Array.isArray(filter)) return filter.some((f) => typeof f === "string" && eq(f, actual));
  return typeof filter === "string" && eq(filter, actual);
}

function getLogs(world: MockWorld, filter: Record<string, unknown>) {
  if (filter.blockHash !== undefined) {
    const hash = filter.blockHash;
    const logs = world.transfers.filter((t) => typeof hash === "string" && eq(mockBlockHash(t.blockNumber), hash));
    return logs.map((l) => formatLog(world, l)).filter((l) => matches(filter, l));
  }
  const from = blockParam(world, filter.fromBlock ?? "latest");
  const to = blockParam(world, filter.toBlock ?? "latest");
  if (from > to) throw new RpcError(-32602, "invalid block range params");
  if (to - from + 1n > MAX_LOG_BLOCK_RANGE)
    throw new RpcError(-32602, `query exceeds max block range ${MAX_LOG_BLOCK_RANGE}`);
  return world.transfers
    .filter((t) => t.blockNumber >= from && t.blockNumber <= to)
    .map((l) => formatLog(world, l))
    .filter((l) => matches(filter, l));
}

function matches(filter: Record<string, unknown>, log: ReturnType<typeof formatLog>): boolean {
  const address = filter.address;
  if (address !== undefined && address !== null) {
    const list = Array.isArray(address) ? address : [address];
    if (!list.some((a) => typeof a === "string" && eq(a, log.address))) return false;
  }
  const topics = Array.isArray(filter.topics) ? filter.topics : [];
  return topics.every((t: unknown, i) => topicMatches(t, log.topics[i] as Hex | undefined));
}

function blockObject(world: MockWorld, n: bigint) {
  const txs = [...world.transactions.values()].filter((t) => t.blockNumber === n).map((t) => t.hash);
  return {
    number: hex(n),
    hash: mockBlockHash(n),
    parentHash: n === 0n ? `0x${"0".repeat(64)}` : mockBlockHash(n - 1n),
    timestamp: hex(GENESIS_TIMESTAMP + n),
    nonce: "0x0000000000000000",
    difficulty: "0x1",
    totalDifficulty: hex(n + 1n),
    gasLimit: hex(1_125_899_906_842_624n),
    gasUsed: hex(21_000n * BigInt(txs.length)),
    baseFeePerGas: hex(MOCK_GAS_PRICE),
    miner: zeroAddress,
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    transactionsRoot: keccak256(toHex(`tx:${n}`)),
    stateRoot: keccak256(toHex(`state:${n}`)),
    receiptsRoot: keccak256(toHex(`receipts:${n}`)),
    sha3Uncles: keccak256("0xc0"),
    mixHash: `0x${"0".repeat(64)}`,
    size: "0x220",
    transactions: txs,
    uncles: [],
  };
}

async function sendRawTransaction(world: MockWorld, raw: Hex): Promise<Hex> {
  const tx = parseTransaction(raw);
  const from = await recoverTransactionAddress({
    serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"],
  });
  if (tx.chainId !== undefined && tx.chainId !== world.chainId)
    throw new RpcError(-32000, "invalid chain id for signer");
  const expectedNonce = world.nonces.get(from.toLowerCase()) ?? 0;
  const nonce = tx.nonce ?? 0;
  if (nonce < expectedNonce) throw new RpcError(-32000, "nonce too low");
  if (nonce > expectedNonce) throw new RpcError(-32000, "nonce too high");
  const gas = tx.gas ?? 21_000n;
  const price = tx.maxFeePerGas ?? tx.gasPrice ?? MOCK_GAS_PRICE;
  const value = tx.value ?? 0n;
  const balance = world.balance(from);
  const cost = value + gas * price;
  if (balance < cost)
    throw new RpcError(-32000, `insufficient funds for gas * price + value: balance ${balance}, tx cost ${cost}`);
  // Value transfer only: calldata is accepted but never executed against fixture contracts.
  world.balances.set(from.toLowerCase(), balance - value - 21_000n * MOCK_GAS_PRICE);
  if (tx.to) world.balances.set(tx.to.toLowerCase(), world.balance(tx.to) + value);
  world.nonces.set(from.toLowerCase(), expectedNonce + 1);
  const hash = keccak256(raw);
  world.transactions.set(hash, { hash, from, to: tx.to ?? null, value, blockNumber: world.mine() });
  return hash;
}

function receipt(world: MockWorld, hash: unknown) {
  const tx = typeof hash === "string" ? world.transactions.get(hash as Hex) : undefined;
  if (!tx) return null;
  return {
    transactionHash: tx.hash,
    transactionIndex: "0x0",
    blockHash: mockBlockHash(tx.blockNumber),
    blockNumber: hex(tx.blockNumber),
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: hex(21_000n),
    gasUsed: hex(21_000n),
    effectiveGasPrice: hex(MOCK_GAS_PRICE),
    contractAddress: null,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    status: "0x1",
    type: "0x2",
  };
}

function param<T = unknown>(params: readonly unknown[] | undefined, index: number): T {
  return params?.[index] as T;
}

function addressParam(params: readonly unknown[] | undefined, index: number): Address {
  const value = param(params, index);
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new RpcError(-32602, "invalid address");
  return value;
}

/** Dispatches one JSON-RPC method against the world. Throws RpcError for protocol-level failures. */
export async function dispatch(
  world: MockWorld,
  method: string,
  params: readonly unknown[] | undefined,
): Promise<unknown> {
  switch (method) {
    case "eth_chainId":
      return hex(world.chainId);
    case "net_version":
      return String(world.chainId);
    case "web3_clientVersion":
      return "pl-mock-rpc/0.1.0";
    case "eth_blockNumber":
      return hex(world.head);
    case "eth_getBalance":
      blockParam(world, param(params, 1));
      return hex(world.balance(addressParam(params, 0)));
    case "eth_getCode": {
      const address = addressParam(params, 0);
      const contracts = [world.generations, world.registry, MULTICALL3_ADDRESS];
      const isTba = [...world.friends.values()].some((f) => eq(f.tokenBoundAccount, address));
      return contracts.some((c) => eq(c, address)) || isTba ? FAKE_CODE : "0x";
    }
    case "eth_getTransactionCount":
      return hex(world.nonces.get(addressParam(params, 0).toLowerCase()) ?? 0);
    case "eth_gasPrice":
      return hex(MOCK_GAS_PRICE);
    case "eth_maxPriorityFeePerGas":
      return "0x0";
    case "eth_getBlockByNumber":
      return blockObject(world, blockParam(world, param(params, 0)));
    case "eth_call": {
      const tx = param<{ to?: Address | null; data?: Hex; input?: Hex } | undefined>(params, 0);
      if (!tx || typeof tx !== "object") throw new RpcError(-32602, "missing call object");
      const block = blockParam(world, param(params, 1));
      return call(world, tx.to ?? undefined, tx.data ?? tx.input ?? "0x", block);
    }
    case "eth_estimateGas": {
      const tx = param<{ from?: Address; value?: Hex; data?: Hex; input?: Hex } | undefined>(params, 0) ?? {};
      const value = tx.value ? BigInt(tx.value) : 0n;
      if (tx.from && value > world.balance(tx.from)) throw new RpcError(-32000, "insufficient funds for transfer");
      const data = tx.data ?? tx.input;
      return hex(data && data !== "0x" ? 200_000n : 21_000n);
    }
    case "eth_getLogs": {
      const filter = param<Record<string, unknown> | undefined>(params, 0);
      if (!filter || typeof filter !== "object") throw new RpcError(-32602, "missing filter");
      return getLogs(world, filter);
    }
    case "eth_sendRawTransaction": {
      const raw = param(params, 0);
      if (typeof raw !== "string" || !isHex(raw)) throw new RpcError(-32602, "invalid raw transaction");
      return sendRawTransaction(world, raw);
    }
    case "eth_getTransactionReceipt":
      return receipt(world, param(params, 0));
    default:
      throw new RpcError(-32601, `the method ${method} does not exist/is not available`);
  }
}

/** Handles one request object, turning thrown RpcErrors (and injected faults) into error responses. */
export async function handleRequest(world: MockWorld, request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = request.id ?? null;
  world.requests.push(String(request.method));
  const fault = world.fault;
  if (fault?.kind === "rpc-error" && (!fault.methods || fault.methods.includes(request.method))) {
    return { jsonrpc: "2.0", id, error: { code: fault.code ?? -32603, message: fault.message ?? "mock RPC fault" } };
  }
  try {
    if (typeof request.method !== "string") throw new RpcError(-32600, "invalid request");
    return { jsonrpc: "2.0", id, result: await dispatch(world, request.method, request.params) };
  } catch (error) {
    if (error instanceof RpcError) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) },
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { jsonrpc: "2.0", id, error: { code: -32603, message } };
  }
}
