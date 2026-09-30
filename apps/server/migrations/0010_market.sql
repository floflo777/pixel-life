-- SIMULATED Gold Pixel market (tokenomics §6 phase 1; contracts/src/GoldPixelMarket.sol).
-- A Gold Pixel lives as a count in seedpack_friend.inventory (outcome 4). When one enters the market it becomes a
-- "leaf": a row that remembers the Friend that grew it (the origin royalty target) and who holds it now.
--   held    : counted in holder_token's inventory (a Gold bought on the market, relistable by id)
--   listed  : escrowed by the market (removed from the seller's inventory, so the regrowth perk ends)
--   redeemed: the holder's inventory fell below its held leaves (Seed Pack redeem); the leaf is gone
-- Amounts are micro-RF (bigint). Simulated balances are friends.sim_rf_micro.

CREATE TABLE market_leaves (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  origin_token  token_id NOT NULL,
  holder_token  token_id,
  state         text NOT NULL CHECK (state IN ('held', 'listed', 'redeemed')),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  CHECK ((state = 'held') = (holder_token IS NOT NULL))
);
CREATE INDEX market_leaves_holder ON market_leaves (holder_token, id) WHERE state = 'held';
CREATE INDEX market_leaves_origin ON market_leaves (origin_token);

-- Open asks only: one per leaf, like `listings[leafId]` on chain. Cancel and buy delete the row.
CREATE TABLE market_listings (
  leaf_id       bigint PRIMARY KEY REFERENCES market_leaves (id),
  seller_token  token_id NOT NULL,
  price_micro   bigint NOT NULL CHECK (price_micro > 0),
  created_at    timestamptz NOT NULL
);
CREATE INDEX market_listings_floor ON market_listings (price_micro, created_at, leaf_id);
CREATE INDEX market_listings_seller ON market_listings (seller_token);

-- Append-only event log mirroring Listed / Cancelled / Sold.
CREATE TABLE market_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind              text NOT NULL CHECK (kind IN ('Listed', 'Cancelled', 'Sold')),
  mode              text NOT NULL CHECK (mode = 'sim'),
  leaf_id           bigint NOT NULL REFERENCES market_leaves (id),
  seller_token      token_id NOT NULL,
  price_micro       bigint CHECK (price_micro > 0),
  origin_token      token_id,
  buyer_token       token_id,
  burned_micro      bigint CHECK (burned_micro >= 0),
  to_origin_micro   bigint CHECK (to_origin_micro >= 0),
  to_creator_micro  bigint CHECK (to_creator_micro >= 0),
  to_seller_micro   bigint CHECK (to_seller_micro >= 0),
  created_at        timestamptz NOT NULL,
  CHECK ((kind = 'Cancelled') = (price_micro IS NULL)),
  CHECK (
    (kind = 'Sold') = (
      origin_token IS NOT NULL AND buyer_token IS NOT NULL AND burned_micro IS NOT NULL
      AND to_origin_micro IS NOT NULL AND to_creator_micro IS NOT NULL AND to_seller_micro IS NOT NULL
    )
  ),
  CHECK (kind <> 'Sold' OR burned_micro + to_origin_micro + to_creator_micro + to_seller_micro = price_micro),
  CHECK (buyer_token IS NULL OR buyer_token <> seller_token)
);
CREATE INDEX market_events_fills ON market_events (created_at DESC, id DESC) WHERE kind = 'Sold';
CREATE INDEX market_events_leaf ON market_events (leaf_id, id);
CREATE INDEX market_events_origin ON market_events (origin_token) WHERE kind = 'Sold';

-- Double-entry legs of every sale (micro-RF): buyer −price; burn, origin, creator, seller +shares. Sums to 0 per sale.
-- The RF sinks of a sale (burn + origin royalty) are also one rf_ledger row (kind 'market_fee') for the global stats.
CREATE TABLE market_ledger (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES market_events (id),
  leg           text NOT NULL CHECK (leg IN ('buyer', 'burn', 'origin', 'creator', 'seller')),
  token_id      token_id,
  amount_micro  bigint NOT NULL,
  created_at    timestamptz NOT NULL,
  CHECK ((leg IN ('buyer', 'origin', 'seller')) = (token_id IS NOT NULL)),
  CHECK ((leg = 'buyer' AND amount_micro < 0) OR (leg <> 'buyer' AND amount_micro >= 0)),
  UNIQUE (event_id, leg)
);
CREATE INDEX market_ledger_token ON market_ledger (token_id, created_at DESC) WHERE token_id IS NOT NULL;
