-- ============================================================================
-- SECURITY PHASE 1 — Lock down every table, grant the admin full CRUD.
-- Run in the Supabase SQL Editor. Claude Code does NOT run this.
--
-- PREREQUISITES (Phase 1a, done by you in the Supabase dashboard FIRST):
--   - Authentication → Providers: enable Email (email/password).
--   - Create ONE admin account (your own).
--   - Authentication → Sign In / Providers: DISABLE new sign-ups (invite-only).
--   - Get the admin UID: Authentication → Users, or:  SELECT id FROM auth.users;
--   - Replace BOTH occurrences of <ADMIN_UID> below with that UID.
--
-- SEQUENCING WARNING: the moment this runs, the app's current (anon, no-login)
-- requests stop working entirely — that is the intended "fully locked" state.
-- So deploy the login UI (Phase 1d) FIRST, confirm you can log in, THEN run this.
-- ============================================================================

-- 0) Sanity check — confirm this list matches your real public tables.
--    Run this and tell Claude Code if anything extra appears:
--    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;

-- 1b) Enable RLS. With RLS ON and no policy, a table is fully closed to the
--     anon and authenticated roles (only the secret/service_role bypasses it).
ALTER TABLE trades                ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_futures_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_spot_holdings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_spot_sales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_holdings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flows            ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE setup_tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE psychology_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_tags         ENABLE ROW LEVEL SECURITY;

-- 1c) Admin-only full CRUD on every table, tied to the specific admin UID
--     (defense-in-depth: even a second authenticated account can't write).
--     Re-runnable: drops any prior same-named policy first.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trades','crypto_futures_trades','crypto_spot_holdings','crypto_spot_sales',
    'stock_transactions','stock_holdings','dividends','cash_flows',
    'account_settings','setup_tags','psychology_tags','analysis_tags'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS admin_full_access ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY admin_full_access ON public.%I
         FOR ALL TO authenticated
         USING (auth.uid() = %L::uuid)
         WITH CHECK (auth.uid() = %L::uuid);',
      t, '<ADMIN_UID>', '<ADMIN_UID>'
    );
  END LOOP;
END $$;

-- Reload the PostgREST schema cache so the API picks up the new policies.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- AFTER RUNNING — quick verify in the SQL Editor:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
--     -> rowsecurity = true for all 12.
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname='public';
--     -> one 'admin_full_access' per table.
-- End state: anon = nothing (read+write blocked). Admin (after login) = full.
-- Public read-only slice comes in Phase 2 (curated views + anon grants).
-- ============================================================================
