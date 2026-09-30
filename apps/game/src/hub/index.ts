/** The Sky (hub) scene (architecture §2.1 `createHubScene`), its HubNet adapters and the pure hub logic it is built from. */
export { createHubScene, voxelFriendFactory, HUB_PIXEL } from "./scene";
export type * from "./types";
export {
  hubNetFromClient,
  createLocalHub,
  createLocalHubNet,
  localTransport,
  LocalSocket,
  type HubNet,
  type HubNetState,
  type HubClientNetOptions,
  type LocalJoin,
} from "./net";
export {
  QUICK_CHAT_TEXT,
  EMOTE_GLYPH,
  STARTER_EMOTES,
  EMOTE_COOLDOWN_MS,
  phraseText,
  emoteName,
  emoteId,
} from "./phrases";
export { BubbleBoard, DEFAULT_BUBBLE_TIMING, type Bubble, type BubbleTiming } from "./bubbles";
export { selectNear, selectTags, NEAR_BUDGET, TAG_RULES, type TagLevel } from "./lod";
export { LocalWalker, type WalkArea, type MoveIntent } from "./walker";
export { classifyTap, stickAxis, screenToGround, type TapIntent, type FriendHitBox } from "./intents";
export { followGoal, deadZoneFor, type FocusBounds } from "./camera";
export { DoorTracker, type DoorZone } from "./doors";
export { emoteFrame, emoteDurationMs } from "./emotes";
export { WORLD_PER_WIRE, toWorld, toWire, facingFromHeading } from "./coords";
export { haloTint, statusLine, dailyCountdown, ROOM_NAMES, venueName } from "./status";
export { buildRoom, roomZones, type RoomView, type RoomLabel } from "./rooms";
