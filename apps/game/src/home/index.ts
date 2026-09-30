/** Home island ("igloo"): scene, edit mode, decor models and worn hats / belt bands (GDD §12.3–12.4). */
export { createHomeScene, type HomeFriend, type HomeScene, type HomeSceneOptions } from "./scene";
export { HomeEditor, type EditRefusal, type EditResult, type HomeEditEvent } from "./editor";
export { buildDecorGeometry, DecorLibrary, type DecorModelMesh } from "./decor";
export { beltRow, buildBelt, buildHat, HAT_ART, hatVoxels, type HatVoxel, type Wearable } from "./wearables";
export { cellCenter, pickTile, placementCenter, terraceOrigin, TILE, type Tile } from "./grid";
