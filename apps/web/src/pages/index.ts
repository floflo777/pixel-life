/**
 * Pixel Life pages. Every page is prop-driven (data as `Remote<T>` + callbacks), so the shell wires them to its API
 * client, identity and router without the pages knowing about either. Suggested routes (GDD §6.1):
 * `/f/:tokenId` → FriendPage (+ RegrowFlow / MendFlow), `/mend` → MendBoard, `/board` → DailyBoard,
 * `/economy` → EconomyPage, `/market` → MarketPage, `/about` → AboutPage.
 */
export { AboutPage, type AboutPageProps, ONE_SENTENCE_RULE } from "./AboutPage.js";
export { DailyBoard, type DailyBoardProps } from "./DailyBoard.js";
export {
  GOLD_FLOOR_MICRO,
  MARKET_FEES,
  MARKET_SELLER_BPS,
  marketParts,
  marketSplit,
  MEND_PARTS,
  quoteParts,
  REGROW_PARTS,
  SEED_BANKROLL_MICRO,
  seedPackFacts,
} from "./economy.js";
export { CONTRACTS, EconomyPage, type EconomyPageProps, LIVE_STATUS } from "./EconomyPage.js";
export { FriendPage, type FriendPageProps, type Mender, mendersFromInbox, type Viewer } from "./FriendPage.js";
export { inboxCopy } from "./inbox-copy.js";
export { demoListings, type GoldListing, MarketPage, type MarketPageProps } from "./MarketPage.js";
export { type MendBoardProps, type MendCandidate, MendBoard, mendRows, type MendRow } from "./MendBoard.js";
export { firstPixels, MendFlow, type MendFlowProps, RegrowFlow, type SpendFlowProps } from "./SpendFlow.js";
