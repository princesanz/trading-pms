import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';
import type { StockTransaction, StockHolding, Dividend, CashFlow, AnalysisTag } from '../types';

export function useEquitiesData() {
  const { session, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [cashFlows, setCashFlows] = useState<CashFlow[]>([]);
  const [analysisTags, setAnalysisTags] = useState<AnalysisTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txRes, holdingsRes, dividendsRes, cashFlowsRes, tagsRes] = await Promise.all([
        // Plain select + client-side tag join — FK-embedded joins fail on the
        // migrated DB (missing FK metadata) and used to be swallowed silently.
        supabase.from('stock_transactions').select('*').order('tanggal', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('stock_holdings').select('*').order('emiten', { ascending: true }),
        supabase.from('dividends').select('*').order('tanggal_cum_date', { ascending: false }),
        supabase.from('cash_flows').select('*').eq('desk', 'Saham').order('tanggal', { ascending: true }),
        supabase.from('analysis_tags').select('*').order('name', { ascending: true }),
      ]);

      const firstError = txRes.error || holdingsRes.error || dividendsRes.error || cashFlowsRes.error || tagsRes.error;
      if (firstError) {
        console.error('[useEquitiesData] fetch error:', firstError);
        setError(firstError.message);
      }

      const tags = (tagsRes.data ?? []) as AnalysisTag[];
      setAnalysisTags(tags);
      if (txRes.data) {
        const tagById = new Map(tags.map(t => [t.id, t]));
        setTransactions(txRes.data.map((tx: StockTransaction) => ({
          ...tx,
          analysis_tag_obj: tx.analysis_tag ? tagById.get(tx.analysis_tag) : undefined,
        })));
      }
      if (holdingsRes.data) setHoldings(holdingsRes.data as StockHolding[]);
      if (dividendsRes.data) setDividends(dividendsRes.data as Dividend[]);
      if (cashFlowsRes.data) setCashFlows(cashFlowsRes.data as CashFlow[]);
    } catch (e: any) {
      console.error('[useEquitiesData] fetch failed:', e);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
  }, [authLoading, session]);

  return { transactions, holdings, dividends, cashFlows, analysisTags, loading: loading || authLoading, error, refetch: fetchData };
}
