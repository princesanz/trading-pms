import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { fetchUsdIdrRate, FALLBACK_USD_IDR } from '../lib/frankfurterApi';

/**
 * USD/IDR rate provider for the Overview's currency normalization.
 *
 * Same shape as the price providers but on a 1-HOUR interval (USD/IDR barely
 * moves intraday). Tab-hidden pause, AbortController cleanup, last-known-rate
 * retention on failure. `usdIdrRate` is ALWAYS a usable number — live, last
 * known, or FALLBACK_USD_IDR — so AUM never shows blank/zero on an FX failure.
 *
 *   status: 'loading'  — first fetch in flight (using fallback value meanwhile)
 *           'live'     — last fetch succeeded
 *           'stale'    — a later fetch failed; showing last good rate
 *           'fallback' — never fetched successfully this session; using the constant
 */

export type FxRateStatus = 'loading' | 'live' | 'stale' | 'fallback';

type FxRateContextValue = {
  usdIdrRate: number; // IDR per 1 USD
  status: FxRateStatus;
  lastUpdated: number | null;
  refresh: () => void;
};

const FxRateContext = createContext<FxRateContextValue | null>(null);
const POLL_MS = 60 * 60 * 1000; // 1 hour

export function FxRateProvider({ children }: { children: ReactNode }) {
  const [usdIdrRate, setUsdIdrRate] = useState<number>(FALLBACK_USD_IDR);
  const [status, setStatus] = useState<FxRateStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const rate = await fetchUsdIdrRate(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setUsdIdrRate(rate);
      hasDataRef.current = true;
      setLastUpdated(Date.now());
      setStatus('live');
    } catch {
      if (ctrl.signal.aborted) return;
      setStatus(hasDataRef.current ? 'stale' : 'fallback');
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval != null) return;
      load();
      interval = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (interval != null) {
        clearInterval(interval);
        interval = null;
      }
      abortRef.current?.abort();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [load]);

  return (
    <FxRateContext.Provider value={{ usdIdrRate, status, lastUpdated, refresh: load }}>
      {children}
    </FxRateContext.Provider>
  );
}

export function useFxRate() {
  const ctx = useContext(FxRateContext);
  if (!ctx) throw new Error('useFxRate must be used within an FxRateProvider');
  return ctx;
}
