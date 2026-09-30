/**
 * The hub mount point. `createHubScene(stage, net, identity)` from `@pl/game` (feat/hub-scene) will plug in here; until
 * it lands, `placeholderHubScene` shows the plaza with your Friend and the resting Friends of the room, and the hub page
 * offers the doors as DOM buttons. Swap the factory in `hubSceneFactory` when the real scene is merged.
 */
import type { FriendView } from "@pl/shared";
import type { VenueIdentity } from "@pl/venue-kit";
import type { HubNet } from "../net/hub-net.js";
import type { GameStage } from "../stage/runtime.js";
import type * as StageRuntime from "../stage/runtime.js";

/** Doors the hub can open (GDD §6.1). */
export type HubDoor = "pixel-life" | "greenhouse" | "daily-stone" | "mend-well" | "seed-booth";

/** A mounted hub scene. */
export interface HubScene {
  /** Called when the shell's identity changes (loaner swap, owner bound). */
  setIdentity(identity: VenueIdentity): void;
  /** Offline "resting" Friends to show around the plaza. */
  setResting(friends: readonly FriendView[]): void;
  /** Subscribes to door activations (walk-in or tap); returns an unsubscribe. */
  onDoor(cb: (door: HubDoor) => void): () => void;
  dispose(): void;
}

/** Signature of `createHubScene` (architecture §2.1). */
export type HubSceneFactory = (
  stage: GameStage,
  net: HubNet,
  identity: () => VenueIdentity,
  rt: typeof StageRuntime,
) => HubScene;

/** Placeholder hub: the plaza scene with "you" and the resting Friends; doors are DOM buttons on the hub page. */
export const placeholderHubScene: HubSceneFactory = (stage, _net, identity, rt) => {
  const plaza = rt.buildPlazaScene(stage);
  plaza.setYou(identity().friend);
  return {
    setIdentity: (id) => plaza.setYou(id.friend),
    setResting: (friends) => plaza.setCrowd(friends),
    onDoor: () => () => undefined,
    dispose: () => plaza.dispose(),
  };
};

/** The factory the hub page uses. */
export const hubSceneFactory: HubSceneFactory = placeholderHubScene;
