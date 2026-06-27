import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
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

// Same pattern for Forex: one gold-api poller for the whole desk, mounted only
// while a Forex page is open.
function ForexPriceLayout() {
  return (
    <ForexPriceProvider>
      <Outlet />
    </ForexPriceProvider>
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

            {/* Forex desk — read views (live gold prices) */}
            <Route element={<ForexPriceLayout />}>
              <Route path="/forex" element={<Dashboard />} />
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
  );
}
