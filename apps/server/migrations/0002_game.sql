-- Pixel Life game API (T7b): appearance cache, run replay inputs, quotes/locks, stitches, Bits,
-- per-Friend seed-pack play numbers and the packs-sold counter.

-- ── Appearance cache (architecture §4.3: immutable art, "KV cache via Postgres") ─────────────────
CREATE TABLE friend_appearance (
  token_id    token_id PRIMARY KEY,
  registry    eth_address NOT NULL,
  family_id   smallint NOT NULL CHECK (family_id BETWEEN 0 AND 8),
  seed        bigint NOT NULL CHECK (seed >= 0),
  frames      jsonb NOT NULL CHECK (jsonb_typeof(frames) = 'array' AND jsonb_array_length(frames) = 64),
  fetched_at  timestamptz NOT NULL
);

-- ── Runs: everything a replay needs, and what was persisted ────────────────────────────────────
ALTER TABLE runs
  ADD COLUMN arena         text NOT NULL DEFAULT 'meadow' CHECK (arena ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  ADD COLUMN venue_id      text NOT NULL DEFAULT 'pixel-life' CHECK (venue_id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  -- SimConfig.friend at submission: {front, lost, familyId, goldHeld} (guests: null, not replayed against a Friend row)
  ADD COLUMN sim_friend    jsonb CHECK (sim_friend IS NULL OR jsonb_typeof(sim_friend) = 'object'),
  -- pixels actually added to the Friend's scars (after front/cap/floor clipping); null when not applied
  ADD COLUMN applied_lost  hex64,
  ADD COLUMN bits          integer NOT NULL DEFAULT 0 CHECK (bits >= 0),
  ADD COLUMN verified_at   timestamptz,
  ADD COLUMN replay_hash   text;
CREATE INDEX runs_daily ON runs (day, token_id) WHERE day IS NOT NULL;

-- ── Economy quotes (live mode) and their 15 min free-regrowth locks (tokenomics §5.3) ──────────
CREATE TABLE economy_quotes (
  id             text PRIMARY KEY CHECK (id ~ '^0x[0-9a-f]{64}$'),   -- bytes32 quoteId as the sink event carries it
  kind           text NOT NULL CHECK (kind IN ('regrow', 'mend')),
  payer_token    token_id NOT NULL,
  subject_token  token_id NOT NULL,
  pixels         hex64 NOT NULL,
  total          uint256_amount NOT NULL,
  created_at     timestamptz NOT NULL,
  locked_until   timestamptz NOT NULL,
  consumed_at    timestamptz,
  CHECK (locked_until > created_at)
);
CREATE INDEX economy_quotes_locks ON economy_quotes (subject_token, locked_until) WHERE consumed_at IS NULL;

-- ── Mend stitches (visible 7 days, adornment.visibleStitches) ─────────────────────────────────
CREATE TABLE stitches (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_token  token_id NOT NULL,
  payer_token   token_id NOT NULL,
  pixels        hex64 NOT NULL,
  at            timestamptz NOT NULL
);
CREATE INDEX stitches_target ON stitches (target_token, at DESC);

-- ── Bits (tokenomics §7): account-bound soft currency, never RF ───────────────────────────────
CREATE TABLE bits_accounts (
  account       text PRIMARY KEY CHECK (length(account) BETWEEN 1 AND 64),  -- lowercase owner address
  balance       bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned_day    date,
  earned_today  integer NOT NULL DEFAULT 0 CHECK (earned_today >= 0),
  updated_at    timestamptz NOT NULL
);

-- ── Seed Pack: SDK play ids are per Friend (1, 2, 3 …), like createGamePreview ───────────────
ALTER TABLE seedpack_plays ADD COLUMN play_no bigint;
UPDATE seedpack_plays p SET play_no = n.rn
  FROM (SELECT id, row_number() OVER (PARTITION BY token_id ORDER BY id) AS rn FROM seedpack_plays) n
  WHERE p.id = n.id;
ALTER TABLE seedpack_plays ALTER COLUMN play_no SET NOT NULL;
ALTER TABLE seedpack_plays ADD CONSTRAINT seedpack_plays_play_no_check CHECK (play_no >= 1);
ALTER TABLE seedpack_plays ADD CONSTRAINT seedpack_plays_token_play_no_key UNIQUE (token_id, play_no);
ALTER TABLE seedpack_house ADD COLUMN packs_sold bigint NOT NULL DEFAULT 0 CHECK (packs_sold >= 0);

-- ── Live ledger ids: contracts/README.md uses `live:<chain>:<txHash>:<logIndex>` (up to ~90 chars) ──
ALTER TABLE rf_ledger DROP CONSTRAINT rf_ledger_id_check;
ALTER TABLE rf_ledger ADD CONSTRAINT rf_ledger_id_check CHECK (length(id) BETWEEN 1 AND 128);
