-- ============================================================================
-- Migration: add missing stock_holdings.market column
-- ============================================================================
-- Context: src/types.ts declares StockHolding.market ('IDX' | 'US' | 'CRYPTO')
--          and app code references it, but the live (migrated) DB is missing
--          the column — confirmed 2026-07-03 via PostgREST error 42703
--          "column stock_holdings.market does not exist".
--
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================================

-- 1. Add the column (default IDX matches the app's historical default)
ALTER TABLE stock_holdings
  ADD COLUMN IF NOT EXISTS market text NOT NULL DEFAULT 'IDX';

-- 2. Constrain to the values the app knows about
ALTER TABLE stock_holdings
  DROP CONSTRAINT IF EXISTS stock_holdings_market_check;
ALTER TABLE stock_holdings
  ADD CONSTRAINT stock_holdings_market_check
  CHECK (market IN ('IDX', 'US', 'CRYPTO'));

-- 3. Backfill from stock_transactions where possible:
--    each holding takes the market of its most recent transaction for the
--    same emiten (holdings are derived from transactions, so this is the
--    authoritative source; anything unmatched stays at the 'IDX' default).
UPDATE stock_holdings h
SET market = t.market
FROM (
  SELECT DISTINCT ON (emiten) emiten, market
  FROM stock_transactions
  ORDER BY emiten, created_at DESC
) t
WHERE h.emiten = t.emiten
  AND t.market IS NOT NULL;

-- 4. Report result for manual review
SELECT emiten, market, total_lot, average_price
FROM stock_holdings
ORDER BY market, emiten;

-- 5. Reload PostgREST schema cache so the new column is queryable immediately
NOTIFY pgrst, 'reload schema';
