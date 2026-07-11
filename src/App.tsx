import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AppLayout } from './components/layout/AppLayout';
import { CommandBar, type ParsedTrade } from './components/adm/CommandBar';
import { useForexPolling } from './state/prices';
import { usePortfolioData } from './hooks/useSupabase';
import { useAuth } from './contexts/AuthProvider';
import { insertForexTrade } from './lib/forexTradeInsert';
import type { Trade } from './types';
import { CryptoPriceProvider } from './contexts/CryptoPriceProvider';
import { ForexPriceProvider } from './contexts/ForexPriceProvider';
import { FxRateProvider } from './contexts/FxRateProvider';
import { AuthProvider } from './contexts/AuthProvider';
import { RequireAdmin } from './components/RequireAdmin';

// Auth + unified landing
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';

// Forex Desk pages
import { Dashboard } from './pages/Dashboard';
import { TradeEntry } from './pages/TradeEntry';
import { TradeHistory } from './pages/TradeHistory';
import { OpenPositions } from './pages/OpenPositions';
import { CashFlow } from './pages/CashFlow';

// Crypto Desk pages
import { CryptoDashboard } from './pages/crypto/CryptoDashboard';
import { SpotHoldings } from './pages/crypto/SpotHoldings';
import { FuturesTradeEntry } from './pages/crypto/FuturesTradeEntry';
import { FuturesJournal } from './pages/crypto/FuturesJournal';
import { CryptoCashFlow } from './pages/crypto/CryptoCashFlow';

// Equities (Saham) Desk pages
import { EquitiesDashboard } from './pages/saham/EquitiesDashboard';
import { StockTransactionEntry } from './pages/saham/StockTransactionEntry';
import { StockPortfolio } from './pages/saham/StockPortfolio';
import { StockHistory } from './pages/saham/StockHistory';
import { DividendTracker } from './pages/saham/DividendTracker';
import { SahamCashFlow } from './pages/saham/SahamCashFlow';

// Export pages — lazy-loaded so the heavy xlsx dependency stays out of the initial bundle.
// (.then maps the named export onto `default`, which React.lazy requires.)
const ForexExport = lazy(() => import('./pages/ForexExport').then(m => ({ default: m.ForexExport })));
const CryptoExport = lazy(() => import('./pages/crypto/CryptoExport').then(m => ({ default: m.CryptoExport })));
const SahamExport = lazy(() => import('./pages/saham/SahamExport').then(m => ({ default: m.SahamExport })));

const exportFallback = <div className="p-8 text-slate-400">Loading...</div>;

// Wraps the Crypto routes so a single live-price poller mounts once for the whole
// desk and runs only while a Crypto page is open.
function CryptoPriceLayout() {
  return (
    <CryptoPriceProvider>
      <Outlet />
    </CryptoPriceProvider>
  );
}

/**
 * Forex desk layout (redesign Phase 2): prices poll via the zustand store
 * (ref-counted, one 5s gold-api poller for the desk — the context provider no
 * longer wraps these routes), and the CommandBar is mounted desk-wide on `n`.
 *
 * CommandBar submit = OPTIMISTIC: a temp row lands in the ['trades'] cache
 * immediately (journal/positions update at once), the Supabase write runs in
 * the background through the SAME insert path as the Trade Entry form
 * (lib/forexTradeInsert — identical snapshots), and the cache reconciles to
 * server truth on success or rolls back with an alert on failure.
 */
function ForexDeskLayout() {
  useForexPolling();
  const { session, isAdmin } = useAuth();
  const { trades, cashFlows, settings, setupTags, instrumentSpecs } = usePortfolioData();

  const submit = (t: ParsedTrade) => {
    const uid = session?.user?.id ?? 'anon';
    // A #tag matching a setup tag's name becomes the setup; otherwise it stays in notes.
    const setup = t.tag ? setupTags.find(s => s.name.toLowerCase() === t.tag!.toLowerCase())?.id : undefined;
    const payload = {
      tanggal: new Date().toISOString().split('T')[0],
      instrumen: t.symbol,
      category: 'forex' as const,
      posisi: (t.side === 'buy' ? 'Buy' : 'Sell') as Trade['posisi'],
      lot: t.size,
      leverage: 100, // form default; adjust via the full form when it matters
      harga_entry: t.entry,
      sl: t.sl,
      tp: t.tp,
      komisi_swap: 0,
      setup,
      catatan: t.tag && !setup ? `#${t.tag}` : undefined,
    };

    // Optimistic cache entry — placeholder until the server assigns ids/snapshots.
    const tempRow = {
      ...payload,
      id: `temp-${Date.now()}`,
      status: 'Open',
      trade_number: null,
      net_pnl: null,
      saldo_akun: null,
    } as unknown as Trade;
    queryClient.setQueryData<Trade[]>(['trades', uid], old => [...(old ?? []), tempRow]);

    void insertForexTrade(payload, { settings, cashFlows, trades, instrumentSpecs }).then(res => {
      if (res.error) alert(`Trade rejected by the server: ${res.error.message}`);
      // Reconcile to server truth either way (real ids on success, rollback on failure).
      void queryClient.invalidateQueries({ queryKey: ['trades'] });
    });
  };

  return (
    <>
      {isAdmin && <CommandBar desk="forex" onSubmit={submit} />}
      <Outlet />
    </>
  );
}

// The Overview aggregates all desks, so it needs the FX rate plus BOTH live-price
// feeds (Forex gold + Crypto Binance) for live unrealized P&L. One nested wrapper.
function OverviewProviders() {
  return (
    <FxRateProvider>
      <ForexPriceProvider>
        <CryptoPriceProvider>
          <Outlet />
        </CryptoPriceProvider>
      </ForexPriceProvider>
    </FxRateProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<AppLayout />}>
            {/* Unified landing — defaults here on app open */}
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route element={<OverviewProviders />}>
              <Route path="/overview" element={<Overview />} />
            </Route>

            {/* Forex desk — read views (live gold prices via the price store) */}
            <Route element={<ForexDeskLayout />}>
              <Route path="/forex" element={<Dashboard />} />
              <Route path="/open-positions" element={<OpenPositions />} />
              <Route path="/journal" element={<TradeHistory />} />
            </Route>

            {/* Crypto desk — read views (live Binance prices) */}
            <Route element={<CryptoPriceLayout />}>
              <Route path="/crypto" element={<CryptoDashboard />} />
              <Route path="/crypto/spot" element={<SpotHoldings />} />
              <Route path="/crypto/futures/journal" element={<FuturesJournal />} />
            </Route>

            {/* Equities desk — read views */}
            <Route path="/saham" element={<EquitiesDashboard />} />
            <Route path="/saham/portfolio" element={<StockPortfolio />} />
            <Route path="/saham/history" element={<StockHistory />} />
            <Route path="/saham/dividends" element={<DividendTracker />} />

            {/* Admin-only — write forms, cash flow, exports. These need no live-price
                providers (they compute from realized data), so they sit outside them. */}
            <Route element={<RequireAdmin />}>
              <Route path="/trade/new" element={<TradeEntry />} />
              <Route path="/cashflow" element={<CashFlow />} />
              <Route path="/export" element={<Suspense fallback={exportFallback}><ForexExport /></Suspense>} />
              <Route path="/crypto/futures/new" element={<FuturesTradeEntry />} />
              <Route path="/crypto/cashflow" element={<CryptoCashFlow />} />
              <Route path="/crypto/export" element={<Suspense fallback={exportFallback}><CryptoExport /></Suspense>} />
              <Route path="/saham/transaction/new" element={<StockTransactionEntry />} />
              <Route path="/saham/cashflow" element={<SahamCashFlow />} />
              <Route path="/saham/export" element={<Suspense fallback={exportFallback}><SahamExport /></Suspense>} />
            </Route>

            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </QueryClientProvider>
  );
}
