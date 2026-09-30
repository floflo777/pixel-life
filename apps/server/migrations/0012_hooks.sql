-- Wave 4 server glue: whole-streak tracking (Whole Week / Whole Moon stamps), Fling Belt trial runs, and the per-venue
-- daily Bits ledger for venues whose runs are not replayed yet (bump-sumo, pixel-putt).

-- When the Friend last became whole (no effective scars), maintained lazily by the server; null while scarred or
-- never observed. `whole` meta events report floor((now - whole_since) / 1 day).
ALTER TABLE friends ADD COLUMN whole_since timestamptz;

-- The belt whose fixed-seed trial a run claims to be (validated at submission, honoured only after replay).
ALTER TABLE runs ADD COLUMN belt_trial text CHECK (belt_trial ~ '^[a-z_]{1,32}$');

-- Bits earned per account, per unverified venue, per UTC day (their own cap, inside the shared daily cap).
CREATE TABLE bits_venue_days (
  account     text NOT NULL CHECK (length(account) BETWEEN 1 AND 64),  -- lowercase owner address
  venue_id    text NOT NULL CHECK (venue_id ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  day         date NOT NULL,
  runs        integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  earned      integer NOT NULL DEFAULT 0 CHECK (earned >= 0),
  PRIMARY KEY (account, venue_id, day)
);
