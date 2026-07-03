-- ============================================================================
-- RLS: anon read-only access for the sanz-brain market snapshot script
-- ============================================================================
-- Purpose: allows projects/sanz-capital/research/fetch-open-positions.sh
--          (in the sanz-brain vault) to read open positions via the anon key,
--          WITHOUT an authenticated session.
--
-- Scope:   SELECT only, limited columns, and (for trade tables) only rows
--          with status = 'Open'. No INSERT/UPDATE/DELETE is granted.
--
-- ⚠️ SECURITY NOTE: the anon key is embedded in the deployed frontend bundle
--    and is therefore PUBLIC. After this runs, anyone with the anon key can
--    read the exposed columns of your open positions. Acceptable for personal
--    monitoring per Sanz's decision (2026-07-03) — revisit if the app ever
--    gets other users.
--
-- Run in: Supabase Dashboard → SQL Editor
-- Rollback: see bottom of file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column-level grants (RLS policies filter ROWS; grants restrict COLUMNS)
-- ---------------------------------------------------------------------------
-- Revoke any blanket select first so only the listed columns are readable.

REVOKE SELECT ON trades                FROM anon;
REVOKE SELECT ON crypto_futures_trades FROM anon;
REVOKE SELECT ON stock_holdings        FROM anon;

GRANT SELECT (instrumen, posisi, lot, harga_entry, sl, tp, net_pnl, status)
  ON trades TO anon;

GRANT SELECT (coin, posisi, notional_usd, harga_entry, sl, tp, net_pnl, status)
  ON crypto_futures_trades TO anon;

GRANT SELECT (emiten, total_lot, average_price)
  ON stock_holdings TO anon;

-- ---------------------------------------------------------------------------
-- 2. RLS policies (row filters, scoped to the anon role only —
--    authenticated-user policies from rls_phase1.sql are unaffected)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS snapshot_anon_read_open_trades ON trades;
CREATE POLICY snapshot_anon_read_open_trades
  ON trades FOR SELECT TO anon
  USING (status = 'Open');

DROP POLICY IF EXISTS snapshot_anon_read_open_futures ON crypto_futures_trades;
CREATE POLICY snapshot_anon_read_open_futures
  ON crypto_futures_trades FOR SELECT TO anon
  USING (status = 'Open');

-- stock_holdings has no status column — holdings are inherently "open"
DROP POLICY IF EXISTS snapshot_anon_read_holdings ON stock_holdings;
CREATE POLICY snapshot_anon_read_holdings
  ON stock_holdings FOR SELECT TO anon
  USING (true);

-- ---------------------------------------------------------------------------
-- 3. Reload PostgREST schema cache so the grants take effect immediately
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (run only if you want to remove snapshot access again)
-- ============================================================================
-- DROP POLICY IF EXISTS snapshot_anon_read_open_trades   ON trades;
-- DROP POLICY IF EXISTS snapshot_anon_read_open_futures  ON crypto_futures_trades;
-- DROP POLICY IF EXISTS snapshot_anon_read_holdings      ON stock_holdings;
-- REVOKE SELECT ON trades                FROM anon;
-- REVOKE SELECT ON crypto_futures_trades FROM anon;
-- REVOKE SELECT ON stock_holdings        FROM anon;
-- NOTIFY pgrst, 'reload schema';
