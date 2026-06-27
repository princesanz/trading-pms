-- ============================================================================
-- EXIT TRACKING — add exit price + close date to trades and crypto futures.
-- Run in the Supabase SQL Editor. Both columns are nullable (open trades have
-- no exit yet; existing closed trades keep NULL until edited).
--
-- net_pnl stays the authoritative result (entered manually at close, matching the
-- broker's actual net). harga_exit / tanggal_tutup are recorded alongside it for
-- the track record and the upcoming Phase 2 public closed-trade views.
-- ============================================================================

ALTER TABLE trades                ADD COLUMN IF NOT EXISTS harga_exit   numeric;
ALTER TABLE trades                ADD COLUMN IF NOT EXISTS tanggal_tutup date;
ALTER TABLE crypto_futures_trades ADD COLUMN IF NOT EXISTS harga_exit   numeric;
ALTER TABLE crypto_futures_trades ADD COLUMN IF NOT EXISTS tanggal_tutup date;

NOTIFY pgrst, 'reload schema';
