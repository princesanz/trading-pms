import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthProvider';
import { attachTradeTags } from './useSupabase';
import { tableQueries } from './tableQueries';
import type { CryptoSpotHolding, CryptoSpotSale, CryptoFuturesTrade, CashFlow, AccountSettings, SetupTag, PsychologyTag } from '../types';

/** react-query wrap (redesign, plumbing only) — see usePortfolioData for the
 *  semantics. account_settings / setup_tags / psychology_tags share keys with
 *  the forex hook, so they are fetched once and served from cache here. */
export function useCryptoData() {
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user?.id ?? 'anon';
  const enabled = !authLoading;

  const [spotQ, salesQ, futuresQ, cashFlowsQ, settingsQ, setupsQ, psychQ] = useQueries({
    queries: [
      { ...tableQueries.cryptoSpotHoldings(uid), enabled },
      { ...tableQueries.cryptoSpotSales(uid), enabled },
      { ...tableQueries.cryptoFuturesTrades(uid), enabled },
      { ...tableQueries.cashFlowsDesk('Crypto', uid), enabled },
      { ...tableQueries.accountSettings(uid), enabled },
      { ...tableQueries.setupTags(uid), enabled },
      { ...tableQueries.psychologyTags(uid), enabled },
    ],
  });

  const firstError = spotQ.error || salesQ.error || futuresQ.error || cashFlowsQ.error || settingsQ.error || setupsQ.error || psychQ.error;
  const error = firstError ? firstError.message : null;
  useEffect(() => {
    if (firstError) console.error('[useCryptoData] fetch error:', firstError);
  }, [firstError]);

  const setupTags = (setupsQ.data ?? []) as SetupTag[];
  const psychologyTags = (psychQ.data ?? []) as PsychologyTag[];
  const futuresTrades = useMemo(
    () => (futuresQ.data ? (attachTradeTags(futuresQ.data as CryptoFuturesTrade[], setupTags, psychologyTags) as CryptoFuturesTrade[]) : []),
    [futuresQ.data, setupsQ.data, psychQ.data] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const all = [spotQ, salesQ, futuresQ, cashFlowsQ, settingsQ, setupsQ, psychQ];
  const loading = authLoading || all.some(q => q.isPending && q.fetchStatus !== 'idle') || all.some(q => q.isFetching);
  const refetch = () => {
    void Promise.all(all.map(q => q.refetch()));
  };

  return {
    spotHoldings: (spotQ.data ?? []) as CryptoSpotHolding[],
    spotSales: (salesQ.data ?? []) as CryptoSpotSale[],
    futuresTrades,
    cashFlows: (cashFlowsQ.data ?? []) as CashFlow[],
    settings: (settingsQ.data ?? null) as AccountSettings | null,
    setupTags,
    psychologyTags,
    loading,
    error,
    refetch,
  };
}
