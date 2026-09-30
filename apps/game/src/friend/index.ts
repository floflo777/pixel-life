/** Voxel Friend renderer: static hub model (LOD 0/1/2), detachable venue model, pose driver and pure mesher. */
export {
  buildFriendModel,
  clearFriendCaches,
  friendCacheStats,
  CRACK_GLOW,
  DEFAULT_PIXEL_SIZE,
  FRIEND_DEPTH,
  type FriendHaloOptions,
  type FriendLod,
  type FriendModel,
  type FriendModelOptions,
} from "./model.js";
export { buildDetachableFriend, type DetachableFriend, type DetachableFriendOptions } from "./detachable.js";
export { facingFromDelta, PoseClock, POSE_FPS, resolvePose, type ResolvedPose } from "./pose.js";
export { lodForPixelSize, projectedPixelSize } from "./lod.js";
export { FRIEND_COLORS, HALO_TIERS } from "./palette.js";
export { composeLayers, friendAnchor, Cell, type FriendLayers } from "./layers.js";
export { greedyRects, meshFriend, triangleCount, type FriendMeshData } from "./mesher.js";
export { disposeSharedFriendResources } from "./resources.js";
