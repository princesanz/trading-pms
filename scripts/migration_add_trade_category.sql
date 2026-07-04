-- ============================================================================
-- Track Record — asset-category tagging on the trades (Forex desk) table.
-- Run in the Supabase SQL Editor. No backfill: no closed trades exist yet.
-- ============================================================================

CREATE TYPE asset_category AS ENUM ('forex', 'crypto', 'stock');

ALTER TABLE trades ADD COLUMN category asset_category;

-- Refresh PostgREST's schema cache so the API sees the new column.
NOTIFY pgrst, 'reload schema';
