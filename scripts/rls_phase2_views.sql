-- ============================================================================
-- SECURITY PHASE 2 — Curated public read-only views.
-- Run in the Supabase SQL Editor. Raw tables stay anon-blocked (Phase 1 RLS);
-- anon reads ONLY these views, which expose just safe columns/rows.
--
-- SECURITY MODEL (deliberate): these are default (SECURITY DEFINER) views owned
-- by postgres, so they read the underlying RLS-locked tables on the caller's
-- behalf — the intended "controlled window". The Supabase advisor will show a
-- "Security Definer View" notice for each; that is EXPECTED and correct here
-- (anon never gets raw-table access; column control comes from the SELECT list).
-- We GRANT to anon (public) and authenticated (so the admin's Overview can read
-- the same curated shape without raw queries).
-- ============================================================================

-- ── Open positions ──────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_forex_open_positions AS
  SELECT instrumen AS instrument, posisi AS direction, lot, harga_entry, leverage,
         tanggal AS tanggal_buka, 'Forex'::text AS desk
  FROM trades WHERE status = 'Open';

CREATE OR REPLACE VIEW public_crypto_futures_open AS
  SELECT coin, posisi AS direction, (notional_usd / NULLIF(harga_entry,0)) AS quantity,
         notional_usd, harga_entry, leverage, tanggal AS tanggal_buka
  FROM crypto_futures_trades WHERE status = 'Open';

-- ── Current holdings ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public_crypto_spot_holdings AS
  SELECT coin, jumlah_koin AS quantity, harga_beli_rata AS avg_cost
  FROM crypto_spot_holdings WHERE jumlah_koin > 0;

CREATE OR REPLACE VIEW public_stock_holdings AS
  SELECT emiten AS ticker, total_lot AS quantity_lots, (total_lot * 100) AS quantity_shares,
         average_price AS avg_cost
  FROM stock_holdings WHERE total_lot > 0;

-- ── Closed trades (track record) ────────────────────────────────────────────
CREATE OR REPLACE VIEW public_forex_closed_trades AS
  SELECT instrumen AS instrument, posisi AS direction, lot, harga_entry, harga_exit,
         net_pnl, persen_profit_loss, tanggal AS tanggal_buka, tanggal_tutup, 'Forex'::text AS desk
  FROM trades WHERE status = 'Closed';

CREATE OR REPLACE VIEW public_crypto_futures_closed AS
  SELECT coin, posisi AS direction, (notional_usd / NULLIF(harga_entry,0)) AS quantity,
         notional_usd, harga_entry, harga_exit, net_pnl AS realized_pnl, persen_profit_loss,
         tanggal AS tanggal_buka, tanggal_tutup
  FROM crypto_futures_trades WHERE status = 'Closed';

CREATE OR REPLACE VIEW public_crypto_spot_sales AS
  SELECT coin, jumlah_koin_sold, harga_beli_rata_at_sell, harga_jual, realized_pnl, tanggal
  FROM crypto_spot_sales;

-- Saham sells (no per-sell realized P&L is stored; price/qty/date only).
CREATE OR REPLACE VIEW public_stock_transactions AS
  SELECT emiten AS ticker, tipe, lot AS quantity_lots, (lot * 100) AS quantity_shares, harga, tanggal
  FROM stock_transactions WHERE tipe = 'Sell';

-- ── Aggregates (one row per desk; native currency; no raw cash_flows exposed) ─
-- Mirrors the app's deskAggregates (realized/cost-basis, no live prices):
--   equity     = (all desk cash flows, signed) + closed-trade P&L + holdings cost basis
--   modal_awal = net external capital (Deposits/Withdrawals + cross-desk transfers,
--                excluding reversals and trading-proceeds rows)
--   pnl        = equity - modal_awal
CREATE OR REPLACE VIEW public_desk_aggregates AS
WITH cf AS (
  SELECT desk,
    SUM(CASE WHEN tipe IN ('Deposit','Transfer Masuk')  THEN jumlah
             WHEN tipe IN ('Withdraw','Transfer Keluar') THEN -jumlah ELSE 0 END) AS cash_bal,
    SUM(CASE
          WHEN tipe='Deposit'         AND NOT COALESCE(is_reversal,false) AND NOT COALESCE(is_trading_proceeds,false) THEN jumlah
          WHEN tipe='Withdraw'        AND NOT COALESCE(is_reversal,false) AND NOT COALESCE(is_trading_proceeds,false) THEN -jumlah
          WHEN tipe='Transfer Masuk'  AND desk_tujuan IS NOT NULL THEN jumlah
          WHEN tipe='Transfer Keluar' AND desk_tujuan IS NOT NULL THEN -jumlah
          ELSE 0 END) AS modal_awal
  FROM cash_flows GROUP BY desk
),
fx     AS (SELECT COALESCE(SUM(net_pnl),0) AS v FROM trades WHERE status='Closed'),
cr     AS (SELECT COALESCE(SUM(net_pnl),0) AS v FROM crypto_futures_trades WHERE status='Closed'),
crspot AS (SELECT COALESCE(SUM(jumlah_koin*harga_beli_rata),0) AS v FROM crypto_spot_holdings WHERE jumlah_koin>0),
sh     AS (SELECT COALESCE(SUM(total_cost_basis),0) AS v FROM stock_holdings WHERE total_lot>0)
SELECT 'Forex'::text AS desk, 'USD'::text AS currency,
       COALESCE((SELECT cash_bal FROM cf WHERE desk='Forex'),0) + (SELECT v FROM fx)                         AS equity,
       COALESCE((SELECT modal_awal FROM cf WHERE desk='Forex'),0)                                            AS modal_awal,
       (COALESCE((SELECT cash_bal FROM cf WHERE desk='Forex'),0) + (SELECT v FROM fx))
         - COALESCE((SELECT modal_awal FROM cf WHERE desk='Forex'),0)                                        AS pnl
UNION ALL
SELECT 'Crypto', 'USD',
       COALESCE((SELECT cash_bal FROM cf WHERE desk='Crypto'),0) + (SELECT v FROM cr) + (SELECT v FROM crspot),
       COALESCE((SELECT modal_awal FROM cf WHERE desk='Crypto'),0),
       (COALESCE((SELECT cash_bal FROM cf WHERE desk='Crypto'),0) + (SELECT v FROM cr) + (SELECT v FROM crspot))
         - COALESCE((SELECT modal_awal FROM cf WHERE desk='Crypto'),0)
UNION ALL
SELECT 'Saham', 'IDR',
       COALESCE((SELECT cash_bal FROM cf WHERE desk='Saham'),0) + (SELECT v FROM sh),
       COALESCE((SELECT modal_awal FROM cf WHERE desk='Saham'),0),
       (COALESCE((SELECT cash_bal FROM cf WHERE desk='Saham'),0) + (SELECT v FROM sh))
         - COALESCE((SELECT modal_awal FROM cf WHERE desk='Saham'),0);

-- ── Grants: anon (public) + authenticated (admin Overview reads same shape) ───
GRANT SELECT ON
  public_forex_open_positions, public_crypto_futures_open,
  public_crypto_spot_holdings, public_stock_holdings,
  public_forex_closed_trades, public_crypto_futures_closed,
  public_crypto_spot_sales, public_stock_transactions,
  public_desk_aggregates
TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Verify after running ─────────────────────────────────────────────────────
--   SELECT * FROM public_desk_aggregates;                    -- 3 rows, sane numbers
--   SELECT count(*) FROM public_forex_open_positions;        -- etc.
-- Gate 3 (must FAIL for anon): SELECT * FROM cash_flows;     -- permission denied / empty
