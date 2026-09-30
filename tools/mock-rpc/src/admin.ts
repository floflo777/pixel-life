/**
 * Out-of-band control of a shared mock chain (e2e): when one mock serves both apps/server and every browser, tests
 * cannot hold the `MockWorld` object, so they drive it over HTTP instead (`POST /__admin`). Never enabled by default.
 */
import { isAddress, type Address } from "viem";
import type { Fault, MockWorld } from "./world.js";

/** Path the admin API listens on (same port as the JSON-RPC endpoint). */
export const ADMIN_PATH = "/__admin";

/** One admin operation. Token ids and amounts travel as decimal strings (JSON has no bigint). */
export type AdminOp =
  | { readonly op: "state" }
  | { readonly op: "mint"; readonly tokenId: string; readonly owner: Address; readonly generation?: number }
  | { readonly op: "transfer"; readonly tokenId: string; readonly to: Address }
  | { readonly op: "mine"; readonly blocks?: string }
  | { readonly op: "fund"; readonly address: Address; readonly wei: string }
  | { readonly op: "fault"; readonly fault: Fault | null }
  | { readonly op: "owner"; readonly tokenId: string }
  | { readonly op: "balance"; readonly address: Address };

/** Result of an admin operation: always the new head, plus op-specific fields. */
export interface AdminResult {
  readonly head: string;
  readonly owner?: Address | null;
  readonly balance?: string;
  readonly friends?: number;
  readonly transactions?: number;
}

/** Thrown for malformed admin requests (answered with HTTP 400). */
export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

const bigintOf = (value: unknown, name: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new AdminError(`${name} must be a decimal string`);
  return BigInt(value);
};
const addressOf = (value: unknown, name: string): Address => {
  if (typeof value !== "string" || !isAddress(value, { strict: false }))
    throw new AdminError(`${name} is not an address`);
  return value;
};

/** Applies one admin operation to `world`. Pure dispatch: no I/O, easy to unit-test. */
export function applyAdminOp(world: MockWorld, input: unknown): AdminResult {
  if (!input || typeof input !== "object") throw new AdminError("body must be an object");
  const body = input as Record<string, unknown>;
  const head = () => world.head.toString();
  switch (body["op"]) {
    case "state":
      return { head: head(), friends: world.friends.size, transactions: world.transactions.size };
    case "mint": {
      const generation = body["generation"];
      if (generation !== undefined && (typeof generation !== "number" || !Number.isInteger(generation)))
        throw new AdminError("generation must be an integer");
      const tokenId = bigintOf(body["tokenId"], "tokenId");
      if (world.friends.has(tokenId)) throw new AdminError(`Friend #${tokenId} already exists`);
      world.mint({
        tokenId,
        owner: addressOf(body["owner"], "owner"),
        ...(generation === undefined ? {} : { generation }),
      });
      return { head: head() };
    }
    case "transfer": {
      const tokenId = bigintOf(body["tokenId"], "tokenId");
      if (!world.ownerOf(tokenId)) throw new AdminError(`Friend #${tokenId} is not minted`);
      world.transfer(tokenId, addressOf(body["to"], "to"));
      return { head: head() };
    }
    case "mine":
      world.mine(body["blocks"] === undefined ? 1n : bigintOf(body["blocks"], "blocks"));
      return { head: head() };
    case "fund": {
      const address = addressOf(body["address"], "address");
      world.balances.set(address.toLowerCase(), world.balance(address) + bigintOf(body["wei"], "wei"));
      return { head: head(), balance: world.balance(address).toString() };
    }
    case "fault":
      world.setFault((body["fault"] ?? null) as Fault | null);
      return { head: head() };
    case "owner":
      return { head: head(), owner: world.ownerOf(bigintOf(body["tokenId"], "tokenId")) };
    case "balance": {
      const address = addressOf(body["address"], "address");
      return { head: head(), balance: world.balance(address).toString() };
    }
    default:
      throw new AdminError(`unknown op ${String(body["op"])}`);
  }
}
