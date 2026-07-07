-- ============================================================================
-- Phase 4 migration: Notion Trade Log parity fields on `trades`
-- Adds: trade_number, instrument_specs (+ point_value snapshot), balance_at_open,
--       open_ts, session, and GENERATED risk_usd / risk_pct / rr_planned / rr_actual.
--
-- Safe to re-run: guarded with IF NOT EXISTS / IF EXISTS everywhere.
-- Run in the Supabase SQL editor. RLS is unchanged (existing "allow all" policies
-- already cover trades; instrument_specs gets its own read policy below).
--
-- Column mapping to the generic spec names:
--   entry      -> harga_entry
--   stop_loss  -> sl
--   take_profit-> tp
--   lot_size   -> lot        (already used for unrealized PnL)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TRADE ID — global sequence, auto-increment on insert
-- ----------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN IF NOT EXISTS trade_number BIGINT;
CREATE SEQUENCE IF NOT EXISTS trades_trade_number_seq OWNED BY trades.trade_number;

-- Backfill existing rows deterministically by creation order.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM trades
  WHERE trade_number IS NULL
)
UPDATE trades t SET trade_number = o.rn
FROM ordered o WHERE t.id = o.id;

-- Advance the sequence past the highest backfilled number, then wire it as the default.
SELECT setval('trades_trade_number_seq', COALESCE((SELECT MAX(trade_number) FROM trades), 0) + 1, false);
ALTER TABLE trades ALTER COLUMN trade_number SET DEFAULT nextval('trades_trade_number_seq');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trades_trade_number_key'
  ) THEN
    ALTER TABLE trades ADD CONSTRAINT trades_trade_number_key UNIQUE (trade_number);
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 2. INSTRUMENT SPECS reference table + seed
--    point_value is the USD value of a 1.0 price move per 1.0 lot (== contract size).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS instrument_specs (
  instrument    TEXT PRIMARY KEY,
  point_value   NUMERIC NOT NULL,
  tick_size     NUMERIC,
  contract_size NUMERIC
);

INSERT INTO instrument_specs (instrument, point_value, tick_size, contract_size) VALUES
  ('XAUUSD', 100,     0.01,    100),
  ('XAGUSD', 5000,    0.001,   5000),
  ('DJI30',  5,       1,       5),
  ('NDX100', 20,      0.25,    20),
  ('SPX500', 50,      0.25,    50),
  ('EURUSD', 100000,  0.00001, 100000),
  ('GBPUSD', 100000,  0.00001, 100000),
  ('USDJPY', 100000,  0.001,   100000),
  ('AUDUSD', 100000,  0.00001, 100000),
  ('USDCAD', 100000,  0.00001, 100000),
  ('USDCHF', 100000,  0.00001, 100000),
  ('NZDUSD', 100000,  0.00001, 100000)
ON CONFLICT (instrument) DO NOTHING;

ALTER TABLE instrument_specs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'instrument_specs' AND policyname = 'Allow all anon access instrument_specs'
  ) THEN
    CREATE POLICY "Allow all anon access instrument_specs" ON instrument_specs FOR ALL USING (true);
  END IF;
END$$;

-- ----------------------------------------------------------------------------
-- 3. Plain snapshot columns (set once at insert; never live-recomputed)
-- ----------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN IF NOT EXISTS point_value     NUMERIC;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS balance_at_open NUMERIC;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS open_ts         TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS session         TEXT;

-- open_ts defaults to insert time as a backstop; the app sends an explicit UTC value.
ALTER TABLE trades ALTER COLUMN open_ts SET DEFAULT now();

-- Point value snapshot backstop: if the app didn't send point_value, fill it from
-- instrument_specs at insert. Keeps historical rows correct if a spec changes later.
CREATE OR REPLACE FUNCTION snapshot_point_value() RETURNS trigger AS $$
BEGIN
  IF NEW.point_value IS NULL THEN
    SELECT point_value INTO NEW.point_value FROM instrument_specs WHERE instrument = NEW.instrumen;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_point_value ON trades;
CREATE TRIGGER trg_snapshot_point_value
  BEFORE INSERT ON trades
  FOR EACH ROW EXECUTE FUNCTION snapshot_point_value();

-- ----------------------------------------------------------------------------
-- 4. SESSION classifier (DST-aware via AT TIME ZONE with IANA names — no hardcoded offsets)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION classify_session(open_ts TIMESTAMPTZ) RETURNS TEXT AS $$
DECLARE
  t INT; l INT; n INT;
  is_asian BOOLEAN; is_london BOOLEAN; is_ny BOOLEAN;
BEGIN
  IF open_ts IS NULL THEN RETURN NULL; END IF;
  t := extract(hour FROM open_ts AT TIME ZONE 'Asia/Tokyo')       * 60 + extract(minute FROM open_ts AT TIME ZONE 'Asia/Tokyo');
  l := extract(hour FROM open_ts AT TIME ZONE 'Europe/London')    * 60 + extract(minute FROM open_ts AT TIME ZONE 'Europe/London');
  n := extract(hour FROM open_ts AT TIME ZONE 'America/New_York') * 60 + extract(minute FROM open_ts AT TIME ZONE 'America/New_York');
  is_asian  := t >= 540 AND t < 1080;  -- 09:00–18:00
  is_london := l >= 480 AND l < 960;   -- 08:00–16:00
  is_ny     := n >= 480 AND n < 1020;  -- 08:00–17:00
  IF is_london AND is_ny THEN RETURN 'London/NY Overlap'; END IF;
  IF is_ny     THEN RETURN 'New York'; END IF;
  IF is_london THEN RETURN 'London';   END IF;
  IF is_asian  THEN RETURN 'Asian';    END IF;
  RETURN 'Off-session';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ----------------------------------------------------------------------------
-- 5. GENERATED risk / RR columns (deterministic, materialized).
--    A GENERATED column cannot reference another GENERATED column, so risk_pct /
--    rr_actual inline the risk_usd expression rather than referencing it.
-- ----------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_usd NUMERIC
  GENERATED ALWAYS AS (ABS(harga_entry - sl) * point_value * lot) STORED;

ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_pct NUMERIC
  GENERATED ALWAYS AS (ABS(harga_entry - sl) * point_value * lot / NULLIF(balance_at_open, 0) * 100) STORED;

ALTER TABLE trades ADD COLUMN IF NOT EXISTS rr_planned NUMERIC
  GENERATED ALWAYS AS (ABS(tp - harga_entry) / NULLIF(ABS(harga_entry - sl), 0)) STORED;

-- rr_actual = net realized PnL / risk_usd. net_pnl is written at close, so this
-- materializes automatically when the trade is closed.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS rr_actual NUMERIC
  GENERATED ALWAYS AS (net_pnl / NULLIF(ABS(harga_entry - sl) * point_value * lot, 0)) STORED;

-- ----------------------------------------------------------------------------
-- 6. Backfill existing rows
--    - point_value from instrument_specs
--    - open_ts from created_at (best available timestamp), then session from it
--    (risk_usd / risk_pct / rr_planned / rr_actual are GENERATED — they backfill
--     automatically as soon as their input columns are populated.)
-- ----------------------------------------------------------------------------
UPDATE trades t SET point_value = s.point_value
FROM instrument_specs s
WHERE s.instrument = t.instrumen AND t.point_value IS NULL;

UPDATE trades SET open_ts = created_at
WHERE open_ts IS NULL AND created_at IS NOT NULL;

UPDATE trades SET session = classify_session(open_ts)
WHERE session IS NULL;

-- NOTE: balance_at_open is intentionally NOT backfilled from a live recompute — it is a
-- point-in-time snapshot the app writes at insert. Historical rows keep it NULL (which
-- makes risk_pct NULL for them, as expected) unless you choose to backfill manually.
