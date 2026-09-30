/**
 * The hub's `HubFriendSource` over the REST API, with the caches the scene expects its caller to keep: appearances
 * are immutable (cached forever), public state for 15 s unless the scene asks for a fresh copy after a `scars` /
 * `mended` event. Your own Friend and the baked loaners resolve locally, so the offline plaza still draws them. Each
 * Friend's Fling Belt is fetched alongside its appearance, so `beltOf` (synchronous, read when the voxel model is
 * built) already knows it.
 */
import type { FlingBelt, HubFriendSource } from "@pl/game";
import type { FriendAppearance, FriendPublic, TokenIdStr } from "@pl/shared";

/** Public-state cache lifetime (the server's own `max-age`). */
export const PUBLIC_TTL_MS = 15_000;

/** What the source needs from the API client (a subset of `Api`, easy to fake). */
export interface FriendApi {
  appearance(id: TokenIdStr): Promise<FriendAppearance>;
  publicFriend(id: TokenIdStr): Promise<FriendPublic>;
}

/** Options of {@link createFriendSource}. */
export interface FriendSourceOptions {
  readonly api: FriendApi;
  /**
   * Friends known locally, used instead of the network: you (appearance and `pub`, authoritative) and the baked
   * loaners (appearance only; their public state still comes from the server).
   */
  readonly local?: () => readonly { readonly appearance: FriendAppearance; readonly pub?: FriendPublic }[];
  /** A Friend's worn belt id (`GET /api/home/:id` → `belt`), or null. Failures count as "no belt". */
  readonly belt?: (id: TokenIdStr) => Promise<string | null>;
  readonly now?: () => number;
}

/** The hub's Friend source plus the synchronous belt lookup `createHubScene` takes. */
export interface FriendSource extends HubFriendSource {
  beltOf(tokenId: TokenIdStr): FlingBelt | null;
}

/** Maps a meta `BeltId` (`gulp_master`) to the hub's `FlingBelt` (`gulp-master`); unknown ids → null. */
export function toFlingBelt(id: string | null | undefined): FlingBelt | null {
  switch (id) {
    case "white":
    case "yellow":
    case "orange":
    case "green":
    case "blue":
    case "red":
    case "brown":
    case "purple":
    case "black":
      return id;
    case "gulp_master":
    case "gulp-master":
      return "gulp-master";
    default:
      return null;
  }
}

/** Builds the source. Concurrent requests for the same Friend share one fetch. */
export function createFriendSource(o: FriendSourceOptions): FriendSource {
  const now = o.now ?? Date.now;
  const appearances = new Map<TokenIdStr, Promise<FriendAppearance>>();
  const pubs = new Map<TokenIdStr, { at: number; value: Promise<FriendPublic> }>();
  const belts = new Map<TokenIdStr, FlingBelt | null>();
  const localOf = (id: TokenIdStr) => o.local?.().find((f) => f.appearance.tokenId === id);

  const loadBelt = (id: TokenIdStr): void => {
    if (!o.belt || belts.has(id)) return;
    belts.set(id, null);
    o.belt(id).then(
      (b) => belts.set(id, toFlingBelt(b)),
      () => undefined,
    );
  };

  return {
    appearance(id) {
      let p = appearances.get(id);
      if (!p) {
        const local = localOf(id);
        p = local ? Promise.resolve(local.appearance) : o.api.appearance(id);
        // A failed fetch is not cached: the next room entry retries it.
        p.catch(() => appearances.delete(id));
        appearances.set(id, p);
        loadBelt(id);
      }
      return p;
    },
    publicState(id, fresh = false) {
      // Your own Friend's state is the shell's (guest scars live only in this browser, D-11).
      const local = localOf(id)?.pub;
      if (local) return Promise.resolve(local);
      const hit = pubs.get(id);
      if (hit && !fresh && now() - hit.at < PUBLIC_TTL_MS) return hit.value;
      const value = o.api.publicFriend(id).catch((e: unknown) => {
        pubs.delete(id);
        throw e;
      });
      pubs.set(id, { at: now(), value });
      return value;
    },
    beltOf: (id) => belts.get(id) ?? null,
  };
}
