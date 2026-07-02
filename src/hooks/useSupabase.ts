import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';
import type { Trade, CashFlow, AccountSettings, SetupTag, PsychologyTag } from '../types';

/** Attaches setup_tag / psychology_tag objects client-side from the tag lists.
 *  Avoids PostgREST FK-embedded joins (`setup_tag:setup_tags(...)`), which fail
 *  on the migrated DB where FK metadata is missing — that failure used to be
 *  swallowed silently and left the journal stale/empty after inserts. */
export function attachTradeTags<T extends { setup?: string | null; psikologi?: string | null }>(
  rows: T[],
  setupTags: SetupTag[],
  psychologyTags: PsychologyTag[]
): (T & { setup_tag?: SetupTag; psychology_tag?: PsychologyTag })[] {
  const setupById = new Map(setupTags.map(t => [t.id, t]));
  const psychById = new Map(psychologyTags.map(t => [t.id, t]));
  return rows.map(r => ({
    ...r,
    setup_tag: r.setup ? setupById.get(r.setup) : undefined,
    psychology_tag: r.psikologi ? psychById.get(r.psikologi) : undefined,
  }));
}

export function usePortfolioData() {
  const { session, loading: authLoading } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [setupTags, setSetupTags] = useState<SetupTag[]>([]);
  const [psychologyTags, setPsychologyTags] = useState<PsychologyTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tradesRes, cashFlowsRes, settingsRes, setupsRes, psychRes] = await Promise.all([
        supabase.from('trades').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('cash_flows').select('*').order('tanggal', { ascending: true }),
        supabase.from('account_settings').select('*').limit(1).maybeSingle(),
        supabase.from('setup_tags').select('*'),
        supabase.from('psychology_tags').select('*'),
      ]);

      const firstError = tradesRes.error || cashFlowsRes.error || settingsRes.error || setupsRes.error || psychRes.error;
      if (firstError) {
        console.error('[usePortfolioData] fetch error:', firstError);
        setError(firstError.message);
      }

      const setups = (setupsRes.data ?? []) as SetupTag[];
      const psychs = (psychRes.data ?? []) as PsychologyTag[];
      setSetupTags(setups);
      setPsychologyTags(psychs);
      if (tradesRes.data) setTrades(attachTradeTags(tradesRes.data, setups, psychs) as Trade[]);
      if (cashFlowsRes.data) setCashFlows(cashFlowsRes.data as CashFlow[]);
      if (settingsRes.data) setSettings(settingsRes.data as AccountSettings);
    } catch (e: any) {
      console.error('[usePortfolioData] fetch failed:', e);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Wait until AuthProvider finishes its initial session recovery.
    // Without this gate the fetch races getSession() and hits Supabase
    // with no JWT attached → RLS blocks every row → empty results.
    if (authLoading) return;
    fetchData();
  }, [authLoading, session]);

  return { trades, cashFlows, settings, setupTags, psychologyTags, loading: loading || authLoading, error, refetch: fetchData };
}
