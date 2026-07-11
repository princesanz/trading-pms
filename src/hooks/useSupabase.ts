import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthProvider';
import { tableQueries } from './tableQueries';
import type { Trade, CashFlow, AccountSettings, SetupTag, PsychologyTag, InstrumentSpec } from '../types';

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

/**
 * react-query wrap (redesign, plumbing only): same tables, same SELECTs (see
 * tableQueries.ts), same return shape. staleTime is Infinity — data refreshes
 * only via `refetch` or a table-key invalidation at a mutation site. The auth
 * gate is preserved: queries are disabled until AuthProvider finishes session
 * recovery (otherwise the fetch races getSession() and RLS returns nothing),
 * and the uid in each key re-fetches on login/logout like the old
 * [authLoading, session] effect did.
 */
export function usePortfolioData() {
  const { session, loading: authLoading } = useAuth();
  const uid = session?.user?.id ?? 'anon';
  const enabled = !authLoading;

  const [tradesQ, cashFlowsQ, settingsQ, setupsQ, psychQ, specsQ] = useQueries({
    queries: [
      { ...tableQueries.trades(uid), enabled },
      { ...tableQueries.cashFlowsAll(uid), enabled },
      { ...tableQueries.accountSettings(uid), enabled },
      { ...tableQueries.setupTags(uid), enabled },
      { ...tableQueries.psychologyTags(uid), enabled },
      { ...tableQueries.instrumentSpecs(uid), enabled },
    ],
  });

  // Same error surface as before: first error among the critical five;
  // instrument_specs is non-critical (may not exist pre-Phase-4 migration).
  const firstError = tradesQ.error || cashFlowsQ.error || settingsQ.error || setupsQ.error || psychQ.error;
  const error = firstError ? firstError.message : null;
  useEffect(() => {
    if (firstError) console.error('[usePortfolioData] fetch error:', firstError);
  }, [firstError]);
  useEffect(() => {
    if (specsQ.error) console.warn('[usePortfolioData] instrument_specs unavailable:', specsQ.error.message);
  }, [specsQ.error]);

  const setupTags = (setupsQ.data ?? []) as SetupTag[];
  const psychologyTags = (psychQ.data ?? []) as PsychologyTag[];
  const trades = useMemo(
    () => (tradesQ.data ? (attachTradeTags(tradesQ.data as Trade[], setupTags, psychologyTags) as Trade[]) : []),
    [tradesQ.data, setupsQ.data, psychQ.data] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const loading = authLoading || [tradesQ, cashFlowsQ, settingsQ, setupsQ, psychQ, specsQ].some(q => q.isPending && q.fetchStatus !== 'idle') || [tradesQ, cashFlowsQ, settingsQ, setupsQ, psychQ, specsQ].some(q => q.isFetching);

  const refetch = () => {
    void Promise.all([tradesQ, cashFlowsQ, settingsQ, setupsQ, psychQ, specsQ].map(q => q.refetch()));
  };

  return {
    trades,
    cashFlows: (cashFlowsQ.data ?? []) as CashFlow[],
    settings: (settingsQ.data ?? null) as AccountSettings | null,
    setupTags,
    psychologyTags,
    instrumentSpecs: (specsQ.data ?? []) as InstrumentSpec[],
    loading,
    error,
    refetch,
  };
}
