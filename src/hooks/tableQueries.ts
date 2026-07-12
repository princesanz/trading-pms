/**
 * Per-table react-query descriptors (admin redesign — reviewed diff).
 *
 * SELECT statements are VERBATIM from the pre-wrap hooks; do not edit them
 * here without an explicit decision from Sanz.
 *
 * Key layout: [table, ...scope, uid] — a mutation invalidates by table prefix
 * (e.g. invalidateQueries({ queryKey: ['cash_flows'] })) and hits every scoped
 * variant. uid keeps caches from leaking across login/logout (the old hooks
 * refetched on session change; a key change achieves the same).
 *
 * queryFns THROW on a PostgREST error: react-query then retains the previous
 * data and surfaces the error — matching the old hooks' `if (res.data)`
 * retention semantics. retry is disabled for parity with the old single
 * attempt.
 */
import { supabase } from '../lib/supabase';

async function run<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

// retry: false = parity with the old hooks' single fetch attempt.
// refetchOnMount stays DEFAULT (true): with staleTime Infinity a mount only
// refetches when the query was explicitly invalidated — which is exactly the
// write→invalidate→navigate-to-journal path. Setting it false would serve
// stale journal data after a write made from another page.
const base = { retry: false as const };

export const tableQueries = {
  trades: (uid: string) => ({
    ...base,
    queryKey: ['trades', uid],
    queryFn: () => run(supabase.from('trades').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true })),
  }),
  cashFlowsAll: (uid: string) => ({
    ...base,
    queryKey: ['cash_flows', 'all', uid],
    queryFn: () => run(supabase.from('cash_flows').select('*').order('tanggal', { ascending: true })),
  }),
  cashFlowsDesk: (desk: 'Crypto' | 'Saham', uid: string) => ({
    ...base,
    queryKey: ['cash_flows', desk, uid],
    queryFn: () => run(supabase.from('cash_flows').select('*').eq('desk', desk).order('tanggal', { ascending: true })),
  }),
  accountSettings: (uid: string) => ({
    ...base,
    queryKey: ['account_settings', uid],
    queryFn: () => run(supabase.from('account_settings').select('*').limit(1).maybeSingle()),
  }),
  setupTags: (uid: string) => ({
    ...base,
    queryKey: ['setup_tags', uid],
    queryFn: () => run(supabase.from('setup_tags').select('*')),
  }),
  psychologyTags: (uid: string) => ({
    ...base,
    queryKey: ['psychology_tags', uid],
    queryFn: () => run(supabase.from('psychology_tags').select('*')),
  }),
  instrumentSpecs: (uid: string) => ({
    ...base,
    queryKey: ['instrument_specs', uid],
    queryFn: () => run(supabase.from('instrument_specs').select('*')),
  }),
  cryptoSpotHoldings: (uid: string) => ({
    ...base,
    queryKey: ['crypto_spot_holdings', uid],
    queryFn: () => run(supabase.from('crypto_spot_holdings').select('*').order('tanggal_beli', { ascending: true })),
  }),
  cryptoSpotSales: (uid: string) => ({
    ...base,
    queryKey: ['crypto_spot_sales', uid],
    queryFn: () => run(supabase.from('crypto_spot_sales').select('*').order('tanggal', { ascending: false })),
  }),
  cryptoFuturesTrades: (uid: string) => ({
    ...base,
    queryKey: ['crypto_futures_trades', uid],
    // Plain select + client-side tag join — FK-embedded joins fail on the
    // migrated DB (missing FK metadata) and used to be swallowed silently.
    queryFn: () => run(supabase.from('crypto_futures_trades').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true })),
  }),
  stockTransactions: (uid: string) => ({
    ...base,
    queryKey: ['stock_transactions', uid],
    // Plain select + client-side tag join — see note above.
    queryFn: () => run(supabase.from('stock_transactions').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true })),
  }),
  stockHoldings: (uid: string) => ({
    ...base,
    queryKey: ['stock_holdings', uid],
    queryFn: () => run(supabase.from('stock_holdings').select('*').order('emiten', { ascending: true })),
  }),
  dividends: (uid: string) => ({
    ...base,
    queryKey: ['dividends', uid],
    queryFn: () => run(supabase.from('dividends').select('*').order('tanggal_cum_date', { ascending: false })),
  }),
  analysisTags: (uid: string) => ({
    ...base,
    queryKey: ['analysis_tags', uid],
    queryFn: () => run(supabase.from('analysis_tags').select('*').order('name', { ascending: true })),
  }),
};
