/**
 * Mounts The Sky (`createHubScene` from `@pl/game`) on the shared stage for the `/sky` screen: the online `HubNet`
 * behind a switchable port, REST Friend data with belts, resting Friends from `GET /api/sky?room=`, the shell's audio
 * engine, and the registry's venue list (only shipped venues get a hall). If the room cannot be joined the scene
 * keeps running as the offline single-player plaza (GDD §6.10) until the player retries.
 */
import type { HubAudio, HubScene, VenueEntry } from "@pl/game";
import {
  EMOTES,
  EMPTY_MASK,
  scarsHash,
  type EmoteName,
  type FriendPublic,
  type RoomSlug,
  type SkyFriend,
  type TokenIdStr,
} from "@pl/shared";
import type { VenueIdentity } from "@pl/venue-kit";
import type { ShellAudio } from "../settings/audio.js";
import type { GameStage } from "../stage/runtime.js";
import { createHubNet, createSwitchNet, type HubNet } from "../net/hub-net.js";
import type { LoanerFriend } from "../identity/loaners.js";
import { createFriendSource, type FriendApi } from "./friend-source.js";

/** What the Sky screen shows about the connection. */
export type SkyStatus =
  /** Joining a room (first join, retry, or a bridge). */
  | { readonly kind: "joining" }
  /** Live with other Friends. */
  | { readonly kind: "online" }
  /** Offline single-player plaza (the room refused us or did not answer); `why` is for the banner. */
  | { readonly kind: "offline"; readonly why: string }
  /** The scene itself could not start a room (rare: a broken room build). */
  | { readonly kind: "error"; readonly why: string };

/** The REST calls the hub makes (a subset of the shell `Api`). */
export interface SkyApi extends FriendApi {
  sky(room: RoomSlug): Promise<{ friends: SkyFriend[] }>;
}

/** Options of {@link mountSky}. */
export interface SkyMountOptions {
  readonly stage: GameStage;
  readonly identity: () => VenueIdentity;
  readonly api: SkyApi;
  readonly audio: ShellAudio;
  /** Room to start in (the one the player left for a venue). */
  readonly room: RoomSlug;
  /** Venue ids with a door (the registry). */
  readonly venues: readonly string[];
  /** Baked loaners: drawn locally, and they rest on the offline plaza. */
  readonly loaners: readonly LoanerFriend[];
  /** A Friend's worn belt id, or null. */
  readonly belt?: (tokenId: TokenIdStr) => Promise<string | null>;
  /** Online transport factory (tests inject one; default same-origin `/ws/room/:slug`). */
  readonly online?: () => HubNet;
  /** Offline transport factory (default: an in-memory `@pl/realtime` hub via `@pl/game`). */
  readonly offline?: () => Promise<HubNet>;
  readonly onStatus: (s: SkyStatus) => void;
  readonly onEnterVenue: (e: VenueEntry) => void;
  readonly onRoomChange: (room: RoomSlug) => void;
  readonly onMendRequest: (tokenId: TokenIdStr) => void;
  readonly onFriendTap: (tokenId: TokenIdStr) => void;
}

/** A mounted Sky. */
export interface SkyHandle {
  readonly scene: HubScene;
  /** Emotes this player can use (for the emote bar). */
  readonly emotes: readonly EmoteName[];
  /** Tries the live sky again (from the offline plaza or after a lost connection). */
  retry(): void;
  dispose(): void;
}

/** A whole, resting stand-in for a loaner on the offline plaza. */
export function restingLoaner(l: LoanerFriend, now: number): SkyFriend {
  const pub: FriendPublic = {
    tokenId: l.appearance.tokenId,
    scars: { lost: EMPTY_MASK, updatedAt: now, version: 0 },
    goldHeld: 0,
    glowCracks: 0,
    streak: 0,
    lastSeen: now,
    economy: "sim",
  };
  return { tokenId: l.appearance.tokenId, familyId: l.appearance.familyId, pub };
}

/** Emotes you can use: the 4 starters for guests, all 8 for owners (GDD §11.4). */
export function unlockedEmotes(mode: VenueIdentity["mode"], starters: readonly EmoteName[]): readonly EmoteName[] {
  return mode === "owner" ? EMOTES : starters;
}

/** Adapts the shell's lazily loaded audio engine to the hub's `HubAudio` (silent until the first gesture). */
export function hubAudio(audio: ShellAudio): HubAudio {
  return {
    play: (cue, params) => audio.play(cue, params),
    music: {
      play: (theme) => audio.engine()?.music.play(theme),
      stop: (opts) => audio.engine()?.music.stop(opts),
    },
  };
}

/** Mounts the hub and joins `room` (online first, offline plaza as the fallback). */
export async function mountSky(o: SkyMountOptions): Promise<SkyHandle> {
  const game = await import("@pl/game");
  const net = createSwitchNet((o.online ?? (() => createHubNet()))());
  let online = true;
  let disposed = false;
  let joining = false;

  const offline =
    o.offline ??
    (async (): Promise<HubNet> => {
      const id = o.identity();
      const pub = id.friend.pub;
      return game.createLocalHubNet(game.createLocalHub(), {
        identityKey: "local:you",
        owner: null,
        profile: {
          kind: id.mode,
          tokenId: id.friend.appearance.tokenId,
          loaned: id.loaned,
          scarsHash: scarsHash(pub.scars),
          goldHeld: pub.goldHeld,
        },
      });
    });

  const friends = createFriendSource({
    api: o.api,
    local: () => {
      const you = o.identity().friend;
      return [{ appearance: you.appearance, pub: you.pub }, ...o.loaners.map((l) => ({ appearance: l.appearance }))];
    },
    ...(o.belt ? { belt: o.belt } : {}),
  });

  const status = (s: SkyStatus): void => {
    if (!disposed) o.onStatus(s);
  };

  const emotes = unlockedEmotes(o.identity().mode, game.STARTER_EMOTES);
  const scene = game.createHubScene(o.stage, net, o.identity, {
    friends,
    beltOf: (id) => friends.beltOf(id),
    audio: hubAudio(o.audio),
    room: o.room,
    venues: o.venues,
    unlockedEmotes: emotes,
    resting: async (room) => {
      const you = o.identity().friend.appearance.tokenId;
      if (online) {
        try {
          return (await o.api.sky(room)).friends.filter((f) => f.tokenId !== you);
        } catch {
          // Fall through: the offline set below keeps the island from looking deserted.
        }
      }
      const now = Date.now();
      return room === "plaza"
        ? o.loaners
            .filter((l) => l.appearance.tokenId !== you)
            .slice(0, 8)
            .map((l) => restingLoaner(l, now))
        : [];
    },
    onEnterVenue: o.onEnterVenue,
    onRoomChange: o.onRoomChange,
    onMendRequest: o.onMendRequest,
    onFriendTap: o.onFriendTap,
    onState: (s, detail) => {
      // A live room that later closes (kicked, replaced, server gone for good) or a bridge whose room refuses us:
      // carry on in the offline plaza, with a retry.
      if ((s === "closed" || s === "error") && online && !joining) void fallback(detail ?? "The sky closed the door.");
    },
  });

  const fallback = async (why: string): Promise<void> => {
    if (disposed || joining) return;
    joining = true;
    online = false;
    try {
      net.use(await offline());
      await scene.enter(scene.room ?? o.room);
      status({ kind: "offline", why });
    } catch (e) {
      status({ kind: "error", why: e instanceof Error ? e.message : String(e) });
    } finally {
      joining = false;
    }
  };

  const join = async (): Promise<void> => {
    joining = true;
    status({ kind: "joining" });
    const room = scene.room ?? o.room;
    try {
      if (online) {
        try {
          await scene.enter(room);
          if (!disposed) status({ kind: "online" });
          return;
        } catch (e) {
          if (disposed) return;
          joining = false;
          await fallback(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      await scene.enter(room);
      status({ kind: "offline", why: "offline" });
    } catch (e) {
      status({ kind: "error", why: e instanceof Error ? e.message : String(e) });
    } finally {
      joining = false;
    }
  };

  void join();

  return {
    scene,
    emotes,
    retry() {
      if (disposed || joining) return;
      online = true;
      net.use((o.online ?? (() => createHubNet()))());
      void join();
    },
    dispose() {
      disposed = true;
      scene.dispose();
      net.close();
    },
  };
}
