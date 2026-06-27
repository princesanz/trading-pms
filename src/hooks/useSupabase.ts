import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Trade, CashFlow, AccountSettings, SetupTag, PsychologyTag } from '../types';

export function usePortfolioData() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [setupTags, setSetupTags] = useState<SetupTag[]>([]);
  const [psychologyTags, setPsychologyTags] = useState<PsychologyTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
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

    if (tradesData) setTrades(tradesData as unknown as Trade[]);
    if (cashFlowsData) setCashFlows(cashFlowsData as CashFlow[]);
    if (settingsData) setSettings(settingsData as AccountSettings);
    if (setupsData) setSetupTags(setupsData as SetupTag[]);
    if (psychData) setPsychologyTags(psychData as PsychologyTag[]);
    
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  return { trades, cashFlows, settings, setupTags, psychologyTags, loading, refetch: fetchData };
}
