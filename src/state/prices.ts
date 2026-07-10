/**
 * Live-price store (admin redesign) — zustand slices for the three feeds,
 * with per-symbol selectors so a 5-second tick re-renders ONLY the cells
 * that display a live number, never a whole page.
 *
 * The fetchers (lib/goldApi, lib/binanceApi, lib/frankfurterApi) are reused
 * verbatim; this file only changes WHERE the state lives. Poller behavior
 * replicates the context providers exactly: same intervals, tab-hidden pause,
 * AbortController cleanup, last-known-value retention on failure ('stale'
 * after first success, 'error'/'fallback' before it).
 *
 * The context providers (ForexPriceProvider, CryptoPriceProvider,
 * FxRateProvider) stay untouched and keep serving the PUBLIC gold landing.
 * Admin views migrate to this store desk-by-desk in Phases 1–4. Public and
 * admin never render the same route simultaneously, so no duplicate pollers.
 *
 * Usage:
 *   useForexPolling();                        // once, at the desk layout level
 *   const xau = useForexPrice('XAUUSD');      // in the one cell that shows it
 *   const meta = useForexFeedMeta();          // status badge only
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useEffect } from 'react';
import { fetchForexPrices, type ForexPriceMap } from '../lib/goldApi';
import { fetchAllPrices, type PriceMap } from '../lib/binanceApi';
import { fetchUsdIdrRate, FALLBACK_USD_IDR } from '../lib/frankfurterApi';

export type FeedStatus = 'loading' | 'live' | 'stale' | 'error';
export type FxStatus = 'loading' | 'live' | 'stale' | 'fallback';

type PricesState = {
  forex: { prices: ForexPriceMap; status: FeedStatus; lastUpdated: number | null };
  crypto: { prices: PriceMap; status: FeedStatus; lastUpdated: number | null };
  fx: { usdIdrRate: number; status: FxStatus; lastUpdated: number | null };
};

export const usePrices = create<PricesState>(() => ({
  forex: { prices: new Map(), status: 'loading', lastUpdated: null },
  crypto: { prices: new Map(), status: 'loading', lastUpdated: null },
  fx: { usdIdrRate: FALLBACK_USD_IDR, status: 'loading', lastUpdated: null },
}));

/**
 * Ref-counted poller: N components may acquire it, exactly one interval runs,
 * and it stops (and aborts in-flight fetches) when the last one releases.
 * Mirrors the provider lifecycle, including the visibilitychange pause.
 */
function createPoller(pollMs: number, load: (signal: AbortSignal) => Promise<void>) {
  let refCount = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let abort: AbortController | null = null;

  const run = () => {
    abort?.abort();
    abort = new AbortController();
    void load(abort.signal);
  };
  const start = () => {
    if (interval != null) return;
    run();
    interval = setInterval(run, pollMs);
  };
  const stop = () => {
    if (interval != null) {
      clearInterval(interval);
      interval = null;
    }
    abort?.abort();
  };
  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };

  return {
    acquire(): () => void {
      refCount++;
      if (refCount === 1) {
        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibility);
      }
      return () => {
        refCount--;
        if (refCount === 0) {
          document.removeEventListener('visibilitychange', onVisibility);
          stop();
        }
      };
    },
    refresh: run,
  };
}

// ── forex (gold-api, 5s) ─────────────────────────────────────────────────────
let forexHasData = false;
const forexPoller = createPoller(5000, async (signal) => {
  try {
    const map = await fetchForexPrices(signal);
    if (signal.aborted) return;
    forexHasData = true;
    usePrices.setState({ forex: { prices: map, status: 'live', lastUpdated: Date.now() } });
  } catch {
    if (signal.aborted) return;
    usePrices.setState(s => ({ forex: { ...s.forex, status: forexHasData ? 'stale' : 'error' } }));
  }
});

// ── crypto (Binance, 5s) ─────────────────────────────────────────────────────
let cryptoHasData = false;
const cryptoPoller = createPoller(5000, async (signal) => {
  try {
    const map = await fetchAllPrices(signal);
    if (signal.aborted) return;
    cryptoHasData = true;
    usePrices.setState({ crypto: { prices: map, status: 'live', lastUpdated: Date.now() } });
  } catch {
    if (signal.aborted) return;
    usePrices.setState(s => ({ crypto: { ...s.crypto, status: cryptoHasData ? 'stale' : 'error' } }));
  }
});

// ── USD/IDR (frankfurter, 1h) ────────────────────────────────────────────────
let fxHasData = false;
const fxPoller = createPoller(60 * 60 * 1000, async (signal) => {
  try {
    const rate = await fetchUsdIdrRate(signal);
    if (signal.aborted) return;
    fxHasData = true;
    usePrices.setState({ fx: { usdIdrRate: rate, status: 'live', lastUpdated: Date.now() } });
  } catch {
    if (signal.aborted) return;
    usePrices.setState(s => ({ fx: { ...s.fx, status: fxHasData ? 'stale' : 'fallback' } }));
  }
});

// ── polling hooks — mount at the desk-layout level, like the providers ──────
export function useForexPolling() {
  useEffect(() => forexPoller.acquire(), []);
}
export function useCryptoPolling() {
  useEffect(() => cryptoPoller.acquire(), []);
}
export function useFxPolling() {
  useEffect(() => fxPoller.acquire(), []);
}

export const refreshForex = forexPoller.refresh;
export const refreshCrypto = cryptoPoller.refresh;
export const refreshFx = fxPoller.refresh;

// ── selectors — subscribe to exactly one number / one badge ─────────────────
/** Live price for one symbol — the ONLY subscription a price cell should hold. */
export function useForexPrice(symbol: string): number | undefined {
  return usePrices(s => s.forex.prices.get(symbol));
}
export function useCryptoPrice(symbol: string): number | undefined {
  return usePrices(s => s.crypto.prices.get(symbol));
}
export function useUsdIdrRate(): number {
  return usePrices(s => s.fx.usdIdrRate);
}

/** Feed metadata for StatusBadge — shallow-compared so unchanged status doesn't re-render. */
export function useForexFeedMeta() {
  return usePrices(useShallow(s => ({ status: s.forex.status, lastUpdated: s.forex.lastUpdated })));
}
export function useCryptoFeedMeta() {
  return usePrices(useShallow(s => ({ status: s.crypto.status, lastUpdated: s.crypto.lastUpdated })));
}
export function useFxMeta() {
  return usePrices(useShallow(s => ({ status: s.fx.status, lastUpdated: s.fx.lastUpdated })));
}

/** Whole-map subscription — for aggregate math (desk equity). Re-renders per tick;
 *  use ONLY in components that genuinely consume every price (e.g. AdminOverview). */
export function useForexPriceMap(): ForexPriceMap {
  return usePrices(s => s.forex.prices);
}
export function useCryptoPriceMap(): PriceMap {
  return usePrices(s => s.crypto.prices);
}
