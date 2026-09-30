-- Club Penguin meta (GDD §12, tokenomics §7): home isles, wardrobe / Friend decor, Bits spends, stamps, belts.
-- Item, stamp and belt ids are validated by @pl/shared (`CATALOG`, `STAMPS`, `BELTS`); the DB only bounds their shape.

-- Bits balances (account-bound). Same definition as the game API's migration so either may create it first.
CREATE TABLE IF NOT EXISTS bits_accounts (
  account       text PRIMARY KEY CHECK (length(account) BETWEEN 1 AND 64),  -- lowercase owner address
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned_day    date,
  earned_today  integer NOT NULL DEFAULT 0 CHECK (earned_today >= 0),
  updated_at    timestamptz NOT NULL
);

-- One isle per Friend: layout = shared `HomeLayout` JSON, validated with `validateLayout` before every write.
CREATE TABLE home_isles (
  token_id    token_id PRIMARY KEY,
  layout      jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  hat         text CHECK (hat ~ '^[a-z0-9_]{1,32}$'),
  open        boolean NOT NULL DEFAULT false,
  generation  smallint CHECK (generation BETWEEN 0 AND 255),
  plots       smallint NOT NULL DEFAULT 0 CHECK (plots BETWEEN 0 AND 5),
  version     integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at  timestamptz NOT NULL
);
CREATE INDEX home_isles_open ON home_isles (updated_at DESC) WHERE open;

-- Bits items live in the account wardrobe (any Friend of that wallet may use them).
CREATE TABLE wardrobe_items (
  account     text NOT NULL CHECK (account ~ '^0x[0-9a-f]{40}$'),
  item_id     text NOT NULL CHECK (item_id ~ '^[a-z0-9_]{1,32}$'),
  qty         integer NOT NULL CHECK (qty BETWEEN 1 AND 99),
  first_at    timestamptz NOT NULL,
  PRIMARY KEY (account, item_id)
);

-- RF decor is bound to the Friend (it travels with the NFT; its RF was already burned/streamed).
CREATE TABLE friend_decor (
  token_id    token_id NOT NULL,
  item_id     text NOT NULL CHECK (item_id ~ '^[a-z0-9_]{1,32}$'),
  qty         integer NOT NULL CHECK (qty BETWEEN 1 AND 99),
  first_at    timestamptz NOT NULL,
  PRIMARY KEY (token_id, item_id)
);

-- Audit trail of Bits spent on the catalog, blueprints and plots (Bits never leave the game).
CREATE TABLE bits_spends (
  id          text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  account     text NOT NULL,
  token_id    token_id,
  kind        text NOT NULL CHECK (kind IN ('item', 'blueprint', 'plot')),
  ref         text NOT NULL,
  amount      integer NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL
);
CREATE INDEX bits_spends_account ON bits_spends (account, created_at DESC);

-- Per-Friend meta counters (shared `MetaStats` JSON) read by the stamp rules.
CREATE TABLE meta_stats (
  token_id    token_id PRIMARY KEY,
  stats       jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  updated_at  timestamptz NOT NULL
);

-- The Stamp Book, per Friend (shown on the Friend page and the isle).
CREATE TABLE stamps (
  token_id    token_id NOT NULL,
  stamp_id    text NOT NULL CHECK (stamp_id ~ '^[a-z0-9_]{1,32}$'),
  earned_at   timestamptz NOT NULL,
  PRIMARY KEY (token_id, stamp_id)
);

-- Fling Belts passed, per Friend (belts follow the NFT, like its scars).
CREATE TABLE belts (
  token_id    token_id NOT NULL,
  belt_id     text NOT NULL CHECK (belt_id ~ '^[a-z_]{1,32}$'),
  run_id      text,
  earned_at   timestamptz NOT NULL,
  PRIMARY KEY (token_id, belt_id)
);
