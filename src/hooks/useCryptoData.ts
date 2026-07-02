import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { attachTradeTags } from './useSupabase';
import type { CryptoSpotHolding, CryptoSpotSale, CryptoFuturesTrade, CashFlow, AccountSettings, SetupTag, PsychologyTag } from '../types';

export function useCryptoData() {
  const { session, loading: authLoading } = useAuth();
  const [spotHoldings, setSpotHoldings] = useState<CryptoSpotHolding[]>([]);
  const [spotSales, setSpotSales] = useState<CryptoSpotSale[]>([]);
  const [futuresTrades, setFuturesTrades] = useState<CryptoFuturesTrade[]>([]);
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
      const [spotRes, salesRes, futuresRes, cashFlowsRes, settingsRes, setupsRes, psychRes] = await Promise.all([
        supabase.from('crypto_spot_holdings').select('*').order('tanggal_beli', { ascending: true }),
        supabase.from('crypto_spot_sales').select('*').order('tanggal', { ascending: false }),
        // Plain select + client-side tag join — FK-embedded joins fail on the
        // migrated DB (missing FK metadata) and used to be swallowed silently.
        supabase.from('crypto_futures_trades').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('cash_flows').select('*').eq('desk', 'Crypto').order('tanggal', { ascending: true }),
        supabase.from('account_settings').select('*').limit(1).maybeSingle(),
        supabase.from('setup_tags').select('*'),
        supabase.from('psychology_tags').select('*'),
      ]);

      const firstError = spotRes.error || salesRes.error || futuresRes.error || cashFlowsRes.error || settingsRes.error || setupsRes.error || psychRes.error;
      if (firstError) {
        console.error('[useCryptoData] fetch error:', firstError);
        setError(firstError.message);
      }

      const setups = (setupsRes.data ?? []) as SetupTag[];
      const psychs = (psychRes.data ?? []) as PsychologyTag[];
      setSetupTags(setups);
      setPsychologyTags(psychs);
      if (spotRes.data) setSpotHoldings(spotRes.data as CryptoSpotHolding[]);
      if (salesRes.data) setSpotSales(salesRes.data as CryptoSpotSale[]);
      if (futuresRes.data) setFuturesTrades(attachTradeTags(futuresRes.data, setups, psychs) as CryptoFuturesTrade[]);
      if (cashFlowsRes.data) setCashFlows(cashFlowsRes.data as CashFlow[]);
      if (settingsRes.data) setSettings(settingsRes.data as AccountSettings);
    } catch (e: any) {
      console.error('[useCryptoData] fetch failed:', e);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
  }, [authLoading, session]);

  return { spotHoldings, spotSales, futuresTrades, cashFlows, settings, setupTags, psychologyTags, loading: loading || authLoading, error, refetch: fetchData };
}
