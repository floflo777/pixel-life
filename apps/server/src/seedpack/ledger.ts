import { SEED_PACK } from "@pl/shared";
import {
  maximumPrize,
  outcomeForRoll,
  parseChanceGame,
  type ChanceGameDefinition,
  type GamePlay,
  type GameSnapshot,
} from "@rarefriends/friendsdk/game";

/**
 * The Seed Pack server ledger as a pure state machine that mirrors FriendSDK `createGamePreview` (0.1.4, src/game.ts)
 * operation by operation: same guards in the same order, same error messages, same arithmetic, same play numbering
 * (per Friend, 1-based) and the SDK's own `outcomeForRoll` / `maximumPrize`. The only difference is scope: the house
 * stake, reservations and liability are shared by every Friend (one ChanceGame deployment), while `createGamePreview`
 * keeps one private house per client. With a single Friend the two are identical, which the snapshot tests prove.
 */

/** The Seed Pack table as the SDK parses it (throws at import if `SEED_PACK` ever stops being a valid game). */
export const SEED_PACK_GAME: ChanceGameDefinition = parseChanceGame(SEED_PACK);
/** The prize reserved per purchased pack. */
export const SEED_PACK_MAX_PRIZE = maximumPrize(SEED_PACK_GAME);

const UINT256_MAX = (1n << 256n) - 1n;

/** Everything one Friend's snapshot is built from (wei, like the SDK). */
export interface LedgerState {
  readonly friendId: bigint;
  readonly rfBalance: bigint;
  readonly consumables: bigint;
  readonly stake: bigint;
  readonly reservedPlays: bigint;
  readonly rewardLiability: bigint;
  readonly inventory: readonly bigint[];
  readonly plays: readonly GamePlay[];
}

/** Which SDK failure happened; the route maps it to an HTTP status and `ApiErrorCode`. */
export type LedgerFailure =
  | "invalid_quantity"
  | "invalid_play_id"
  | "seedpack_reserve"
  | "insufficient_funds"
  | "insufficient_consumables"
  | "unknown_play"
  | "already_settled"
  | "unknown_outcome"
  | "no_redemption_value"
  | "insufficient_inventory"
  | "overflow";

/** A refused operation, carrying the SDK's exact message. */
export class LedgerError extends Error {
  constructor(
    readonly failure: LedgerFailure,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** SDK `uint()`: a bigint in range, else `Invalid <name>.` */
function uint(value: bigint, name: string, failure: LedgerFailure, positive = false): bigint {
  if (typeof value !== "bigint" || value < (positive ? 1n : 0n) || value > UINT256_MAX) {
    throw new LedgerError(failure, `Invalid ${name}.`);
  }
  return value;
}

const freeStake = (s: LedgerState) => s.stake - s.reservedPlays - s.rewardLiability;

/** SDK `snapshot()`. */
export function snapshot(s: LedgerState): GameSnapshot {
  return Object.freeze({
    mode: "preview",
    friendId: s.friendId,
    rfBalance: s.rfBalance,
    consumables: s.consumables,
    stake: s.stake,
    freeStake: freeStake(s),
    reservedPlays: s.reservedPlays,
    rewardLiability: s.rewardLiability,
    inventory: Object.freeze([...s.inventory]),
    plays: Object.freeze([...s.plays]),
  });
}

/** SDK `canBuy(quantity)`. */
export function canBuy(s: LedgerState, quantity: bigint): boolean {
  if (typeof quantity !== "bigint" || quantity < 1n || quantity > UINT256_MAX) return false;
  const cost = quantity * SEED_PACK_GAME.price;
  const reserve = quantity * SEED_PACK_MAX_PRIZE;
  return (
    cost <= UINT256_MAX &&
    reserve <= UINT256_MAX &&
    s.stake + cost <= UINT256_MAX &&
    freeStake(s) >= SEED_PACK_MAX_PRIZE &&
    freeStake(s) + cost >= reserve
  );
}

/** SDK `buy(quantity)`: moves the price into the stake and reserves the max prize per pack. */
export function buy(s: LedgerState, quantity: bigint): LedgerState {
  uint(quantity, "quantity", "invalid_quantity", true);
  const cost = quantity * SEED_PACK_GAME.price;
  if (!canBuy(s, quantity))
    throw new LedgerError("seedpack_reserve", "Game needs more free stake to back this purchase.");
  if (cost > s.rfBalance) throw new LedgerError("insufficient_funds", "Insufficient RF.");
  return {
    ...s,
    stake: s.stake + cost,
    rfBalance: s.rfBalance - cost,
    consumables: s.consumables + quantity,
    reservedPlays: s.reservedPlays + quantity * SEED_PACK_MAX_PRIZE,
  };
}

/** SDK `play(quantity = 1)`: consumes packs into unsettled plays numbered `plays.length + 1 …`. */
export function play(s: LedgerState, quantity = 1n): { state: LedgerState; added: GamePlay[] } {
  uint(quantity, "quantity", "invalid_quantity", true);
  if (quantity > s.consumables) throw new LedgerError("insufficient_consumables", "Insufficient consumables.");
  const plays = [...s.plays];
  const added: GamePlay[] = [];
  for (let index = 0n; index < quantity; index++) {
    const p: GamePlay = Object.freeze({ id: BigInt(plays.length + 1), outcomeId: null });
    plays.push(p);
    added.push(p);
  }
  return { state: { ...s, consumables: s.consumables - quantity, plays }, added };
}

/** SDK `settle(playId)`: one roll per play, releasing its reservation into the reward liability. */
export function settle(s: LedgerState, playId: bigint, draw: () => number): { state: LedgerState; play: GamePlay } {
  uint(playId, "play ID", "invalid_play_id", true);
  if (playId > BigInt(s.plays.length)) throw new LedgerError("unknown_play", "Unknown play.");
  const index = Number(playId - 1n);
  const current = s.plays[index];
  if (!current) throw new LedgerError("unknown_play", "Unknown play.");
  if (current.outcomeId !== null) throw new LedgerError("already_settled", "Play is already settled.");
  const outcomeId = outcomeForRoll(SEED_PACK_GAME, draw());
  const outcome = SEED_PACK_GAME.outcomes[outcomeId - 1];
  if (!outcome) throw new Error("outcomeForRoll returned an id outside the table");
  const result: GamePlay = Object.freeze({ id: current.id, outcomeId });
  const inventory = [...s.inventory];
  inventory[outcomeId - 1] = (inventory[outcomeId - 1] ?? 0n) + 1n;
  const plays = [...s.plays];
  plays[index] = result;
  return {
    state: {
      ...s,
      reservedPlays: s.reservedPlays - SEED_PACK_MAX_PRIZE,
      rewardLiability: s.rewardLiability + outcome.reward,
      inventory,
      plays,
    },
    play: result,
  };
}

/** SDK `redeem(outcomeId, quantity)`: burns kept rewards and pays their fixed value from the stake. */
export function redeem(s: LedgerState, outcomeId: number, quantity: bigint): LedgerState {
  uint(quantity, "quantity", "invalid_quantity", true);
  if (!Number.isInteger(outcomeId) || outcomeId < 1 || outcomeId > SEED_PACK_GAME.outcomes.length) {
    throw new LedgerError("unknown_outcome", "Unknown outcome.");
  }
  const index = outcomeId - 1;
  const reward = SEED_PACK_GAME.outcomes[index]?.reward ?? 0n;
  if (reward === 0n) throw new LedgerError("no_redemption_value", "This collectible has no RF redemption value.");
  if ((s.inventory[index] ?? 0n) < quantity) throw new LedgerError("insufficient_inventory", "Insufficient inventory.");
  const amount = reward * quantity;
  uint(s.rfBalance + amount, "RF balance", "overflow");
  const inventory = [...s.inventory];
  inventory[index] = (inventory[index] ?? 0n) - quantity;
  return {
    ...s,
    inventory,
    rewardLiability: s.rewardLiability - amount,
    stake: s.stake - amount,
    rfBalance: s.rfBalance + amount,
  };
}

/** Server roll: SDK `samplePreviewRoll` rejection sampling (all 10,000 buckets equal) on Node's CSPRNG. */
export function serverRoll(): number {
  const word = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(word);
  while ((word[0] ?? 0) >= 4_294_960_000);
  return (word[0] ?? 0) % 10_000;
}
