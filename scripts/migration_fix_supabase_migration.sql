-- ============================================================================
-- REPAIR MIGRATION — post Supabase-migration cleanup (run in SQL Editor).
-- Idempotent: safe to run multiple times.
--
-- Fixes two classes of problems found in the July 2026 audit:
--   A) Legacy cash_flow_type enum values ('Withdrawal', 'Transfer') carried
--      over from the old DB. The app now tolerates them defensively, but the
--      data should be normalized so balances are exact.
--   B) Columns the app writes/reads that exist only if every ad-hoc migration
--      was replayed on the new DB. ADD COLUMN IF NOT EXISTS heals any gaps.
-- ============================================================================

-- ── A) Normalize legacy enum values ─────────────────────────────────────────
-- 'Withdrawal' is a pure rename of 'Withdraw'.
UPDATE cash_flows SET tipe = 'Withdraw'
WHERE tipe::text = 'Withdrawal';

-- Legacy 'Transfer' rows: the old model used a single 'Transfer' with
-- desk_tujuan for the outgoing cross-desk leg. Mirror the app's normalization:
UPDATE cash_flows SET tipe = 'Transfer Keluar'
WHERE tipe::text = 'Transfer' AND desk_tujuan IS NOT NULL;

-- Any remaining 'Transfer' rows have no derivable direction — list them for
-- manual review (the app skips them in balance math until fixed):
SELECT id, tanggal, desk, jumlah, catatan
FROM cash_flows
WHERE tipe::text = 'Transfer';

-- ── B) Heal potentially missing columns ─────────────────────────────────────
ALTER TABLE trades ADD COLUMN IF NOT EXISTS leverage numeric NOT NULL DEFAULT 100;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS harga_exit numeric;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tanggal_tutup date;

ALTER TABLE crypto_futures_trades ADD COLUMN IF NOT EXISTS harga_exit numeric;
ALTER TABLE crypto_futures_trades ADD COLUMN IF NOT EXISTS tanggal_tutup date;

ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'Funding';
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS related_id uuid;
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS is_reversal boolean NOT NULL DEFAULT false;
ALTER TABLE cash_flows ADD COLUMN IF NOT EXISTS is_trading_proceeds boolean NOT NULL DEFAULT false;

ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS modal_awal_crypto numeric NOT NULL DEFAULT 0;

-- ── C) Refresh PostgREST's schema cache so the API sees the changes ─────────
NOTIFY pgrst, 'reload schema';
