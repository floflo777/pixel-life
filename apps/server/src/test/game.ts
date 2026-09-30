import { designWorld } from "@pl/mock-rpc";
import { EMPTY_MASK, fromIndices, frontMask, toIndices, type FriendAppearance, type Hex64 } from "@pl/shared";
import type { LightMyRequestResponse } from "fastify";
import type { Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { Hub, socketTransport } from "@pl/realtime";
import { vi } from "vitest";
import type { WebSocket } from "ws";
import type { BucketSpec, RateScope } from "../security/rate-limit.js";
import { cookieFrom, newWallet, signIn, startHarness, type Harness, type HarnessOptions } from "./harness.js";

/** Design Friends used across the game suites (docs/design/data/friends.json). */
export const MASK = 344030n;
export const ASYMMETRY = 344033n;
export const CELLULAR = 344034n;
export const GEN0 = 1969n;
export const SKELETON = 63675n;
export const HOVERER = 65042n;

const ROOMY: BucketSpec = { capacity: 1000, windowMs: 60_000 };

/** A running app plus two funded-by-sim owners (alice: Mask + Asymmetry + gen-0, bob: Skeleton + Hoverer). */
export interface Game {
  readonly h: Harness;
  readonly alice: PrivateKeyAccount;
  readonly bob: PrivateKeyAccount;
  /** Spies on the hub's post-commit events. */
  readonly events: {
    notify: ReturnType<typeof vi.fn>;
    mended: ReturnType<typeof vi.fn>;
    updateToken: ReturnType<typeof vi.fn>;
  };
}

/** Starts a harness whose rate limits are roomy (except the ones a test pins) and whose hub is observable. */
export async function startGame(
  options: HarnessOptions & { limits?: Partial<Record<RateScope, BucketSpec>> } = {},
): Promise<Game> {
  const alice = newWallet();
  const bob = newWallet();
  const hub = new Hub<WebSocket>({ transport: socketTransport<WebSocket>() });
  const events = {
    notify: vi.spyOn(hub, "notify"),
    mended: vi.spyOn(hub, "mended"),
    updateToken: vi.spyOn(hub, "updateToken"),
  } as unknown as Game["events"];
  const h = await startHarness({
    world: designWorld({
      owners: {
        [alice.address]: [MASK, ASYMMETRY, GEN0],
        [bob.address]: [SKELETON, HOVERER],
        ["0x7777777777777777777777777777777777777777" as Address]: [CELLULAR],
      },
      generationZero: [GEN0],
    }),
    ...options,
    deps: {
      hub,
      ...options.deps,
      rateLimits: {
        auth: ROOMY,
        guest: ROOMY,
        writes: ROOMY,
        economy: ROOMY,
        wsConnect: ROOMY,
        runSubmit: ROOMY,
        ...options.limits,
      },
    },
  });
  return { h, alice, bob, events };
}

/** Signs `wallet` in and binds `tokenId`; returns the session cookie. */
export async function owner(h: Harness, wallet: PrivateKeyAccount, tokenId: bigint): Promise<string> {
  const cookie = await signIn(h, wallet);
  const bound = await h.app.inject({
    method: "POST",
    url: "/api/session/friend",
    headers: { ...h.edge, cookie },
    payload: { tokenId: tokenId.toString() },
  });
  if (bound.statusCode !== 200) throw new Error(`bind failed: ${bound.statusCode} ${bound.body}`);
  return cookie;
}

/** A fresh guest cookie. */
export async function guest(h: Harness): Promise<string> {
  return cookieFrom(await h.app.inject({ method: "POST", url: "/api/guest", headers: h.edge }), "pl_guest");
}

/** JSON request helper through the edge headers. */
export function call(
  h: Harness,
  method: "GET" | "POST" | "DELETE",
  url: string,
  cookie?: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url,
    headers: { ...h.edge, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** The Friend's art as the server serves it. */
export async function art(h: Harness, tokenId: bigint): Promise<FriendAppearance> {
  const r = await call(h, "GET", `/api/friends/${tokenId}/appearance`);
  if (r.statusCode !== 200) throw new Error(`appearance ${r.statusCode}`);
  return r.json() as FriendAppearance;
}

/** The first `n` pixels of the Friend's front mask (by index). */
export async function frontPixels(h: Harness, tokenId: bigint, n: number, skip = 0): Promise<Hex64> {
  return fromIndices(toIndices(frontMask(await art(h, tokenId))).slice(skip, skip + n));
}

/** Overwrites a Friend's stored scars (anchored now) and balance, as if earlier play had happened. */
export async function setFriend(
  h: Harness,
  tokenId: bigint,
  patch: { lost?: Hex64; simMicro?: number; version?: number },
): Promise<void> {
  await h.db.kysely
    .updateTable("friends")
    .set({
      ...(patch.lost !== undefined ? { lost: patch.lost, scar_updated_at: h.clock.now() } : {}),
      ...(patch.version !== undefined ? { scar_version: patch.version } : {}),
      ...(patch.simMicro !== undefined ? { sim_rf_micro: patch.simMicro } : {}),
    })
    .where("token_id", "=", tokenId.toString())
    .execute();
}

/** Marks a Friend as past its newbie runs so run scars persist. */
export async function skipNewbie(h: Harness, tokenId: bigint): Promise<void> {
  const now = h.clock.now();
  await h.db.kysely
    .insertInto("runs")
    .values(
      [0, 1, 2].map((i) => ({
        id: `seed_${tokenId}_${i}`,
        token_id: tokenId.toString(),
        guest_id: null,
        kind: "free" as const,
        day: null,
        seed: i,
        inputs: Buffer.from([0]),
        score: 0,
        lost_delta: EMPTY_MASK,
        final_hash: "x",
        created_at: new Date(now.getTime() - 86_400_000),
      })),
    )
    .execute();
}
