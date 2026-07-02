import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';
import type { Trade, CashFlow, AccountSettings, SetupTag, PsychologyTag } from '../types';

export function usePortfolioData() {
  const { session, loading: authLoading } = useAuth();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [setupTags, setSetupTags] = useState<SetupTag[]>([]);
  const [psychologyTags, setPsychologyTags] = useState<PsychologyTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    console.log('[usePortfolioData] fetchData called, session:', !!session);
    setLoading(true);
    
    // In a real app we'd handle errors properly, but for this MVP we'll just log them
    const [
      { data: tradesData },
      { data: cashFlowsData },
      { data: settingsData },
      { data: setupsData },
      { data: psychData }
    ] = await Promise.all([
      supabase.from('trades').select(`*, setup_tag:setup_tags(id, name), psychology_tag:psychology_tags(id, name)`).order('tanggal', { ascending: true }),
      supabase.from('cash_flows').select('*').order('tanggal', { ascending: true }),
      supabase.from('account_settings').select('*').limit(1).single(),
      supabase.from('setup_tags').select('*'),
      supabase.from('psychology_tags').select('*')
    ]);

    console.log('[usePortfolioData] trades fetched:', tradesData?.length ?? 0, 'rows');

    if (tradesData) setTrades(tradesData as unknown as Trade[]);
    if (cashFlowsData) setCashFlows(cashFlowsData as CashFlow[]);
    if (settingsData) setSettings(settingsData as AccountSettings);
    if (setupsData) setSetupTags(setupsData as SetupTag[]);
    if (psychData) setPsychologyTags(psychData as PsychologyTag[]);
    
    setLoading(false);
  };

  useEffect(() => {
    // Wait until AuthProvider finishes its initial session recovery.
    // Without this gate the fetch races getSession() and hits Supabase
    // with no JWT attached → RLS blocks every row → empty results.
    if (authLoading) {
      console.log('[usePortfolioData] waiting for auth…');
      return;
    }
    console.log('[usePortfolioData] auth ready, fetching data. session:', !!session);
    fetchData();
  }, [authLoading, session]);

  return { trades, cashFlows, settings, setupTags, psychologyTags, loading: loading || authLoading, refetch: fetchData };
}
