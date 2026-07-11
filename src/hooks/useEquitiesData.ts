import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthProvider';
import { tableQueries } from './tableQueries';
import type { StockTransaction, StockHolding, Dividend, CashFlow, AnalysisTag } from '../types';

/** react-query wrap (redesign, plumbing only) — see usePortfolioData for the
 *  semantics. Client-side analysis-tag join preserved unchanged. */
export function useEquitiesData() {
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user?.id ?? 'anon';
  const enabled = !authLoading;

  const [txQ, holdingsQ, dividendsQ, cashFlowsQ, tagsQ] = useQueries({
    queries: [
      { ...tableQueries.stockTransactions(uid), enabled },
      { ...tableQueries.stockHoldings(uid), enabled },
      { ...tableQueries.dividends(uid), enabled },
      { ...tableQueries.cashFlowsDesk('Saham', uid), enabled },
      { ...tableQueries.analysisTags(uid), enabled },
    ],
  });

  const firstError = txQ.error || holdingsQ.error || dividendsQ.error || cashFlowsQ.error || tagsQ.error;
  const error = firstError ? firstError.message : null;
  useEffect(() => {
    if (firstError) console.error('[useEquitiesData] fetch error:', firstError);
  }, [firstError]);

  const analysisTags = (tagsQ.data ?? []) as AnalysisTag[];
  const transactions = useMemo(() => {
    if (!txQ.data) return [];
    const tagById = new Map(analysisTags.map(t => [t.id, t]));
    return (txQ.data as StockTransaction[]).map((tx: StockTransaction) => ({
      ...tx,
      analysis_tag_obj: tx.analysis_tag ? tagById.get(tx.analysis_tag) : undefined,
    }));
  }, [txQ.data, tagsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = [txQ, holdingsQ, dividendsQ, cashFlowsQ, tagsQ];
  const loading = authLoading || all.some(q => q.isPending && q.fetchStatus !== 'idle') || all.some(q => q.isFetching);
  const refetch = () => {
    void Promise.all(all.map(q => q.refetch()));
  };

  return {
    transactions,
    holdings: (holdingsQ.data ?? []) as StockHolding[],
    dividends: (dividendsQ.data ?? []) as Dividend[],
    cashFlows: (cashFlowsQ.data ?? []) as CashFlow[],
    analysisTags,
    loading,
    error,
    refetch,
  };
}
