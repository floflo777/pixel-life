/** Club Penguin meta on the server: home isles, catalog purchases, stamp/belt hooks (GDD §12, tokenomics §7). */
export {
  heldStamps,
  onGoldKept,
  onMendGiven,
  onRunFinished,
  onWhole,
  passedBelts,
  readStats,
  recordMetaEvent,
  type MetaAward,
} from "./hooks.js";
export { registerMetaRoutes } from "./routes.js";
export { homeView } from "./store.js";
