import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { fetchForexPrices, type ForexPriceMap } from '../lib/goldApi';

/**
 * Single source of truth for live gold-api prices on the Forex desk.
 *
 * Mirrors CryptoPriceProvider exactly: ONE 5s poller mounted via a route
 * layout (so it only runs while a Forex page is open and there's exactly one
 * poller no matter how many components subscribe), tab-hidden pause,
 * AbortController cleanup on unmount, last-known prices retained on failure
 * (status flips to 'stale' instead of clearing the map).
 *
 * Today only XAUUSD is live; the `ForexPriceMap` shape lets us add more
 * symbols later without changing the consumer surface.
 */

export type ForexPriceStatus = 'loading' | 'live' | 'stale' | 'error';

type ForexPriceContextValue = {
  prices: ForexPriceMap;
  status: ForexPriceStatus;
  lastUpdated: number | null; // epoch ms of last successful fetch
  refresh: () => void;
};

const ForexPriceContext = createContext<ForexPriceContextValue | null>(null);
const POLL_MS = 5000;

export function ForexPriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<ForexPriceMap>(new Map());
  const [status, setStatus] = useState<ForexPriceStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const map = await fetchForexPrices(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setPrices(map);
      hasDataRef.current = true;
      setLastUpdated(Date.now());
      setStatus('live');
    } catch {
      if (ctrl.signal.aborted) return;
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
    <ForexPriceContext.Provider value={{ prices, status, lastUpdated, refresh: load }}>
      {children}
    </ForexPriceContext.Provider>
  );
}

export function useForexPrices() {
  const ctx = useContext(ForexPriceContext);
  if (!ctx) throw new Error('useForexPrices must be used within a ForexPriceProvider');
  return ctx;
}
