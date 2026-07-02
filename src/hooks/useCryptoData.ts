import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';
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

  const fetchData = async () => {
    setLoading(true);

    const [
      { data: spotData },
      { data: salesData },
      { data: futuresData },
      { data: cashFlowsData },
      { data: settingsData },
      { data: setupsData },
      { data: psychData }
    ] = await Promise.all([
      supabase.from('crypto_spot_holdings').select('*').order('tanggal_beli', { ascending: true }),
      supabase.from('crypto_spot_sales').select('*').order('tanggal', { ascending: false }),
      supabase.from('crypto_futures_trades').select(`*, setup_tag:setup_tags(id, name), psychology_tag:psychology_tags(id, name)`).order('tanggal', { ascending: true }),
      supabase.from('cash_flows').select('*').eq('desk', 'Crypto').order('tanggal', { ascending: true }),
      supabase.from('account_settings').select('*').limit(1).single(),
      supabase.from('setup_tags').select('*'),
      supabase.from('psychology_tags').select('*')
    ]);

    if (spotData) setSpotHoldings(spotData as CryptoSpotHolding[]);
    if (salesData) setSpotSales(salesData as CryptoSpotSale[]);
    if (futuresData) setFuturesTrades(futuresData as unknown as CryptoFuturesTrade[]);
    if (cashFlowsData) setCashFlows(cashFlowsData as CashFlow[]);
    if (settingsData) setSettings(settingsData as AccountSettings);
    if (setupsData) setSetupTags(setupsData as SetupTag[]);
    if (psychData) setPsychologyTags(psychData as PsychologyTag[]);

    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
  }, [authLoading, session]);

  return { spotHoldings, spotSales, futuresTrades, cashFlows, settings, setupTags, psychologyTags, loading: loading || authLoading, refetch: fetchData };
}
