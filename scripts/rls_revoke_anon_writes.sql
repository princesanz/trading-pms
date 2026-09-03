-- Revoke write privileges from anon/authenticated on the curated public_* views.
--
-- WHY
-- ---
-- The public read path is a set of security-DEFINER views: they are owned by
-- `postgres` and none of them set `security_invoker`, so they deliberately read
-- past the base-table RLS that hides `trades` etc. from anon. That is the
-- intended design — rls_phase2_views.sql grants only SELECT on them, and
-- rls_snapshot_anon_read.sql revokes anon's SELECT on the raw tables.
--
-- But Supabase ships a default privilege on schema `public`:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, ...
--
-- (visible in pg_default_acl as `anon=arwdDxtm/postgres` for objtype 'r').
-- That default is safe for TABLES, which RLS still protects. It is NOT safe for
-- VIEWS: a view has no RLS of its own, and because these views are
-- security-definer, a write through one executes with the owner's rights and
-- bypasses the base table's policies entirely.
--
-- The result, confirmed on production 2026-09-03: 8 of the 9 public_* views
-- reported is_updatable = YES, and `SET ROLE anon; UPDATE public_forex_open_positions ...`
-- was permitted. Any visitor holding the anon key — which ships in the client
-- bundle by design — could have written to the trading data.
--
-- FIX
-- ---
-- Take the write bits back. SELECT is untouched, so the public landing is
-- unaffected; the admin writes through the raw tables, never these views, so it
-- is unaffected too.
--
-- Idempotent: REVOKE on an already-revoked privilege is a no-op.

revoke insert, update, delete, truncate on
  public_desk_aggregates,
  public_forex_open_positions,
  public_forex_closed_trades,
  public_crypto_futures_open,
  public_crypto_futures_closed,
  public_crypto_spot_holdings,
  public_crypto_spot_sales,
  public_stock_holdings,
  public_stock_transactions
from anon, authenticated;

-- !! MAINTENANCE !!
-- The default privilege above is still in force, so EVERY NEW public_* view
-- will be created with anon write grants again. Add each new view to the list
-- above and re-run this script. Verify with:
--
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name like 'public\_%'
--     and grantee = 'anon'
--     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
--
-- That query must return zero rows.
--
-- Note: `security_invoker = on` is NOT the fix here. It would make base-table
-- RLS apply, and since anon has no SELECT on `trades`, the public site would
-- go blank. These views are meant to be security-definer read windows; only
-- the write grants were wrong.
