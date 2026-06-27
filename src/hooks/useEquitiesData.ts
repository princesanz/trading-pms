import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { StockTransaction, StockHolding, Dividend, CashFlow, AnalysisTag } from '../types';

export function useEquitiesData() {
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [analysisTags, setAnalysisTags] = useState<AnalysisTag[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);

    const [
      { data: txData },
      { data: holdingsData },
      { data: dividendsData },
      { data: cashFlowsData },
      { data: tagsData },
    ] = await Promise.all([
      supabase.from('stock_transactions').select(`*, analysis_tag_obj:analysis_tags(id, name)`).order('tanggal', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('stock_holdings').select('*').order('emiten', { ascending: true }),
      supabase.from('dividends').select('*').order('tanggal_cum_date', { ascending: false }),
      supabase.from('cash_flows').select('*').eq('desk', 'Saham').order('tanggal', { ascending: true }),
      supabase.from('analysis_tags').select('*').order('name', { ascending: true }),
    ]);

    if (txData) setTransactions(txData as unknown as StockTransaction[]);
    if (holdingsData) setHoldings(holdingsData as StockHolding[]);
    if (dividendsData) setDividends(dividendsData as Dividend[]);
    if (cashFlowsData) setCashFlows(cashFlowsData as CashFlow[]);
    if (tagsData) setAnalysisTags(tagsData as AnalysisTag[]);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  return { transactions, holdings, dividends, cashFlows, analysisTags, loading, refetch: fetchData };
}
