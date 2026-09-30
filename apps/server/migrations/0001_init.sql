-- Pixel Life initial schema: architecture §4.2 translated to PostgreSQL 16.
-- Conventions:
--   * token ids are uint256 -> numeric(78,0) (domain token_id); addresses are lowercase hex (domain eth_address).
--   * timestamps are timestamptz; calendar days (UTC) are date.
--   * micro-RF balances are bigint (JS-safe integers, 1e-6 RF); on-chain audit amounts are numeric(78,0) base units.
--   * every money-like column has a non-negativity CHECK so a bug fails loudly instead of minting.

CREATE DOMAIN token_id AS numeric(78, 0)
  CHECK (VALUE > 0 AND VALUE < 115792089237316195423570985008687907853269984665640564039457584007913129639936);
CREATE DOMAIN eth_address AS text CHECK (VALUE ~ '^0x[0-9a-f]{40}$');
CREATE DOMAIN hex64 AS text CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN tx_hash AS text CHECK (VALUE ~ '^0x[0-9a-f]{64}$');
CREATE DOMAIN uint256_amount AS numeric(78, 0) CHECK (VALUE >= 0);

-- ── Auth (§1.6) ───────────────────────────────────────────────────────────────
CREATE TABLE auth_nonces (
  nonce       text PRIMARY KEY CHECK (nonce ~ '^[A-Za-z0-9]{16,64}$'),
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_nonces_expiry ON auth_nonces (expires_at);

CREATE TABLE sessions (
  sid         uuid PRIMARY KEY,
  address     eth_address NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_address ON sessions (address) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE friend_bindings (
  sid         uuid PRIMARY KEY REFERENCES sessions (sid) ON DELETE CASCADE,
  token_id    token_id NOT NULL,
  address     eth_address NOT NULL,
  tba         eth_address NOT NULL,
  block       bigint NOT NULL CHECK (block >= 0),
  checked_at  timestamptz NOT NULL
);
CREATE INDEX friend_bindings_token ON friend_bindings (token_id);

-- ── Friends and scars (§1.5) ──────────────────────────────────────────────────
CREATE TABLE friends (
  token_id         token_id PRIMARY KEY,
  family_id        smallint NOT NULL CHECK (family_id BETWEEN 0 AND 8),
  seed             bigint NOT NULL CHECK (seed >= 0),
  tba              eth_address,
  last_owner       eth_address,
  lost             hex64 NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  scar_version     integer NOT NULL DEFAULT 0 CHECK (scar_version >= 0),
  scar_updated_at  timestamptz NOT NULL,
  glow_cracks      integer NOT NULL DEFAULT 0 CHECK (glow_cracks >= 0),
  streak           integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
  streak_day       date,
  sim_rf_micro     bigint NOT NULL DEFAULT 0 CHECK (sim_rf_micro >= 0),
  sim_granted_day  date,
  last_seen        timestamptz NOT NULL,
  created_at       timestamptz NOT NULL
);
CREATE INDEX friends_seen ON friends (last_seen DESC);

-- ── Runs and boards (§4.6) ────────────────────────────────────────────────────
CREATE TABLE runs (
  id          text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  token_id    token_id,
  guest_id    text CHECK (length(guest_id) BETWEEN 1 AND 64),
  kind        text NOT NULL CHECK (kind IN ('free', 'daily')),
  day         date,
  seed        bigint NOT NULL CHECK (seed >= 0),
  inputs      bytea NOT NULL CHECK (octet_length(inputs) <= 65536),
  score       integer NOT NULL CHECK (score >= 0),
  lost_delta  hex64 NOT NULL,
  final_hash  text NOT NULL,
  verified    smallint NOT NULL DEFAULT 0 CHECK (verified IN (-1, 0, 1)), -- 0 pending, 1 ok, -1 mismatch
  created_at  timestamptz NOT NULL,
  CHECK ((token_id IS NULL) <> (guest_id IS NULL)),
  CHECK ((kind = 'daily') = (day IS NOT NULL))
);
CREATE INDEX runs_friend ON runs (token_id, created_at DESC) WHERE token_id IS NOT NULL;
CREATE INDEX runs_guest ON runs (guest_id, created_at DESC) WHERE guest_id IS NOT NULL;
CREATE INDEX runs_pending ON runs (created_at) WHERE verified = 0;

CREATE TABLE daily_best (
  day       date NOT NULL,
  board     text NOT NULL CHECK (board IN ('owners', 'visitors')),
  entrant   text NOT NULL,
  score     integer NOT NULL CHECK (score >= 0),
  run_id    text NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  PRIMARY KEY (day, board, entrant)
);
CREATE INDEX daily_rank ON daily_best (day, board, score DESC);

-- ── Economy ledger (§1.5, §4.2) ───────────────────────────────────────────────
CREATE TABLE rf_ledger (
  id            text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  kind          text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('sim', 'live')),
  payer_token   token_id,
  target_token  token_id,
  pixels        integer CHECK (pixels BETWEEN 0 AND 256),
  total         uint256_amount NOT NULL,
  burn          uint256_amount NOT NULL,
  stream        uint256_amount NOT NULL,
  to_target     uint256_amount NOT NULL,
  tx_hash       tx_hash,
  log_index     integer CHECK (log_index >= 0),
  block         bigint CHECK (block >= 0),
  created_at    timestamptz NOT NULL,
  CHECK (burn + stream + to_target = total),
  -- live rows carry their on-chain event coordinates; sim rows never do
  CHECK ((mode = 'live') = (tx_hash IS NOT NULL)),
  CHECK ((tx_hash IS NULL) = (log_index IS NULL)),
  -- one transaction can emit several sink events: (tx_hash, log_index) is the idempotency key
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX ledger_time ON rf_ledger (created_at DESC);
CREATE INDEX ledger_payer ON rf_ledger (payer_token, created_at DESC) WHERE payer_token IS NOT NULL;
CREATE INDEX ledger_target ON rf_ledger (target_token, created_at DESC) WHERE target_token IS NOT NULL;

CREATE TABLE inbox (
  id          text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  token_id    token_id NOT NULL,
  kind        text NOT NULL,
  payload     jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at  timestamptz NOT NULL,
  read_at     timestamptz
);
CREATE INDEX inbox_friend ON inbox (token_id, created_at DESC);
CREATE INDEX inbox_unread ON inbox (token_id) WHERE read_at IS NULL;

-- ── Seed Pack server ledger (mirrors SDK createGamePreview accounting) ─────────
CREATE TABLE seedpack_house (
  id               smallint PRIMARY KEY CHECK (id = 1),
  stake_micro      bigint NOT NULL CHECK (stake_micro >= 0),
  reserved_micro   bigint NOT NULL CHECK (reserved_micro >= 0),
  liability_micro  bigint NOT NULL CHECK (liability_micro >= 0)
);

CREATE TABLE seedpack_friend (
  token_id     token_id PRIMARY KEY,
  consumables  bigint NOT NULL DEFAULT 0 CHECK (consumables >= 0),
  inventory    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(inventory) = 'array') -- int[] per outcome id
);

CREATE TABLE seedpack_plays (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_id    token_id NOT NULL,
  outcome_id  integer CHECK (outcome_id >= 0),
  created_at  timestamptz NOT NULL,
  settled_at  timestamptz,
  CHECK (settled_at IS NULL OR outcome_id IS NOT NULL)
);
CREATE INDEX seedpack_plays_open ON seedpack_plays (token_id) WHERE settled_at IS NULL;

-- ── Chain indexer cursor (live mode) ──────────────────────────────────────────
CREATE TABLE chain_cursor (
  name   text PRIMARY KEY,
  block  bigint NOT NULL CHECK (block >= 0)
);
