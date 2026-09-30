/**
 * Loose Pixels pages. Every view here is prop-driven (data as `Remote<T>` + callbacks) and unit-tested; the routed
 * screens in `./routes/` wire them to the API, identity and router (see `app/routes.ts` for the URL of each). The home
 * isle (`HomeIsle`) is not re-exported here: it pulls in the three.js stage, which only its own route should load.
 */
export { AboutPage, type AboutPageProps, ONE_SENTENCE_RULE } from "./AboutPage.js";
export { DailyBoard, type DailyBoardProps } from "./DailyBoard.js";
export {
  GOLD_FLOOR_MICRO,
  MARKET_SELLER_BPS,
  marketParts,
  MEND_PARTS,
  quoteParts,
  REGROW_PARTS,
  SEED_BANKROLL_MICRO,
  seedPackFacts,
} from "./economy.js";
export { CONTRACTS, EconomyPage, type EconomyPageProps, LIVE_STATUS } from "./EconomyPage.js";
export { FriendPage, type FriendPageProps, type Mender, mendersFromInbox, type Viewer } from "./FriendPage.js";
export { inboxCopy, inboxGlyph, inboxGroup, type InboxGroup, inboxHasRf } from "./inbox-copy.js";
export { MarketPage, type MarketPageProps, parseRf } from "./MarketPage.js";
export { Catalog, type CatalogProps, priceLabel } from "./Catalog.js";
export { BeltLadder, StampBook, type StampBookProps, STAMP_TONE } from "./StampBook.js";
export { cssColor, stampProgress, unlockProblem, unplaced } from "./meta-view.js";
export { type MendBoardProps, type MendCandidate, MendBoard, mendRows, type MendRow } from "./MendBoard.js";
export { firstPixels, MendFlow, type MendFlowProps, RegrowFlow, type SpendFlowProps } from "./SpendFlow.js";
