import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { fetchAllPrices, type PriceMap } from '../lib/binanceApi';

/**
 * Single source of truth for live Binance prices on the Crypto desk.
 *
 * Mounts ONE 5-second poller around the /crypto/* routes (so exactly one poller
 * exists no matter how many components read prices, and it only runs while a
 * Crypto page is open). Pauses while the tab is hidden, aborts in-flight requests
 * on unmount, and retains last-known prices on failure (degrading to 'stale'
 * rather than clearing the table).
 */

export type PriceStatus = 'loading' | 'live' | 'stale' | 'error';

type CryptoPriceContextValue = {
  prices: PriceMap;
  status: PriceStatus;
  lastUpdated: number | null; // epoch ms of last successful fetch
  refresh: () => void;
};

const CryptoPriceContext = createContext<CryptoPriceContextValue | null>(null);
const POLL_MS = 5000;

export function CryptoPriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<PriceMap>(new Map());
  const [status, setStatus] = useState<PriceStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false); // have we ever loaded prices?

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const map = await fetchAllPrices(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setPrices(map);
      hasDataRef.current = true;
      setLastUpdated(Date.now());
      setStatus('live');
    } catch {
      if (ctrl.signal.aborted) return;
      // Keep last-known prices. 'stale' if we had data before, 'error' if never.
      setStatus(hasDataRef.current ? 'stale' : 'error');
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
    <CryptoPriceContext.Provider value={{ prices, status, lastUpdated, refresh: load }}>
      {children}
    </CryptoPriceContext.Provider>
  );
}

export function useCryptoPrices() {
  const ctx = useContext(CryptoPriceContext);
  if (!ctx) throw new Error('useCryptoPrices must be used within a CryptoPriceProvider');
  return ctx;
}
