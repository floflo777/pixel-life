/**
 * Client for the shared e2e mock chain (`@pl/mock-rpc --admin`, started by playwright.config.ts). apps/server and every
 * browser read the same world, so tests mutate it over HTTP. Each test mints its own fresh token ids to its own fresh
 * wallet, which keeps parallel workers (and reruns against a reused local stack) isolated without resetting anything.
 */
import { randomInt } from "node:crypto";
import type { AdminOp, AdminResult, Fault } from "@pl/mock-rpc";
import type { Address } from "viem";
import { SHARED_RPC_URL } from "../env/stack.js";

/** Token ids minted by e2e live in [E2E_TOKEN_BASE, E2E_TOKEN_BASE + 1e9): far from real and design ids. */
export const E2E_TOKEN_BASE = 1_000_000_000;

/** Typed admin operations on the shared chain. */
export interface SharedChain {
  readonly url: string;
  /** Mints a fresh Friend (design frames borrowed by id) to `owner` in a new block; returns its decimal id. */
  mint(owner: Address, options?: { generation?: number }): Promise<string>;
  transfer(tokenId: string, to: Address): Promise<void>;
  mine(blocks?: number): Promise<void>;
  /** Adds `wei` to an address's native balance (the mock charges no gas beyond it). */
  fund(address: Address, wei: bigint): Promise<void>;
  /** Injects (or clears with null) an RPC fault for everyone: only for serial specs. */
  fault(fault: Fault | null): Promise<void>;
  ownerOf(tokenId: string): Promise<Address | null>;
}

async function admin(url: string, op: AdminOp): Promise<AdminResult> {
  const res = await fetch(`${url}/__admin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(op),
  });
  const body = (await res.json()) as AdminResult & { error?: string };
  if (!res.ok) throw new Error(`mock chain admin ${op.op}: ${body.error ?? res.status}`);
  return body;
}

/** A client for the shared mock chain at `url` (default: the e2e stack's). */
export function sharedChain(url: string = SHARED_RPC_URL): SharedChain {
  return {
    url,
    async mint(owner, options = {}) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const tokenId = String(E2E_TOKEN_BASE + randomInt(1_000_000_000));
        try {
          await admin(url, {
            op: "mint",
            tokenId,
            owner,
            ...(options.generation === undefined ? {} : { generation: options.generation }),
          });
          return tokenId;
        } catch (error) {
          if (!(error instanceof Error) || !/already exists/.test(error.message)) throw error;
        }
      }
      throw new Error("could not mint a fresh token id");
    },
    async transfer(tokenId, to) {
      await admin(url, { op: "transfer", tokenId, to });
    },
    async mine(blocks = 1) {
      await admin(url, { op: "mine", blocks: String(blocks) });
    },
    async fund(address, wei) {
      await admin(url, { op: "fund", address, wei: wei.toString() });
    },
    async fault(fault) {
      await admin(url, { op: "fault", fault });
    },
    async ownerOf(tokenId) {
      return (await admin(url, { op: "owner", tokenId })).owner ?? null;
    },
  };
}
