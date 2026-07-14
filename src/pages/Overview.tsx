import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { useCryptoData } from '../hooks/useCryptoData';
import { useEquitiesData } from '../hooks/useEquitiesData';
import { useForexPrices } from '../contexts/ForexPriceProvider';
import { useCryptoPrices } from '../contexts/CryptoPriceProvider';
import { useFxRate } from '../contexts/FxRateProvider';
import { useAuth } from '../contexts/AuthProvider';
import { forexDeskSummary, cryptoDeskSummary, sahamDeskSummary } from '../lib/deskAggregates';
import { deskEquitySeries, combinedEquityCurve } from '../lib/combinedEquity';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { PageHeader } from '../components/adm/PageHeader';
import { StatusBadge } from '../components/adm/StatusBadge';
import { MetricStrip } from '../components/adm/MetricStrip';
import { DataTable, type Column } from '../components/adm/DataTable';
import { ChartPanel } from '../components/adm/ChartPanel';
import { MarketSessionsPanel } from '../components/adm/MarketSessionsPanel';
import { color } from '../design/tokens';
import { fmtUsd, fmtSignedUsd, fmtSignedPct, fmtIdr } from '../design/format';

// Lazy fork (redesign Phase 0): the public gold landing — and with it `three`
// (GoldTerrain) and the public Recharts charts — lives in its own chunk that
// admin routes never download. A <link rel="modulepreload"> for this chunk is
// injected into index.html at build time (see vite.config.ts) so the public
// page pays no discovery roundtrip. The fallback matches GoldLanding's own
// ink-background loading frame, so the public render is visually unchanged.
const GoldLanding = lazy(() => import('./public/gold/GoldLanding').then(m => ({ default: m.GoldLanding })));

/**
 * Admin reads raw tables (full detail + live prices). Public visitors get the
 * gold landing, which reads only the curated public_* views (swappable design).
 */
export function Overview() {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminOverview /> : <PublicOverview />;
}

function PublicOverview() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-ink" />}>
      <GoldLanding />
    </Suspense>
  );
}

type DeskRow = { key: string; desk: string; equity: number; pnl: number; basis: string };

/**
 * Phase 1 redesign: same data layer as before (deskAggregates over the desk
 * hooks + live price contexts), rebuilt with the adm component set. All values
 * here include live unrealized P&L on open positions, so they update on every
 * price tick — deliberately NO count-up animation (redesign motion rule: motion
 * only on discrete writes, never on live ticks).
 */
function AdminOverview() {
  const forex = usePortfolioData();
  const crypto = useCryptoData();
  const saham = useEquitiesData();
  const { prices: forexPrices } = useForexPrices();
  const { prices: cryptoPrices } = useCryptoPrices();
  const { usdIdrRate, status: fxStatus, lastUpdated: fxUpdated, refresh: fxRefresh } = useFxRate();

  const loading = forex.loading || crypto.loading || saham.loading;

  const agg = useMemo(() => {
    const fx = forexDeskSummary(forex.cashFlows, forex.trades, forexPrices);       // USD
    const cr = cryptoDeskSummary(crypto.cashFlows, crypto.futuresTrades, crypto.spotHoldings, cryptoPrices); // USD(T)≈USD
    const shIdr = sahamDeskSummary(saham.cashFlows, saham.holdings);               // IDR

    // Saham IDR → USD: rate is IDR per 1 USD, so divide.
    const shUsd = {
      equity: shIdr.equity / usdIdrRate,
      pnl: shIdr.pnl / usdIdrRate,
      modalAwal: shIdr.modalAwal / usdIdrRate,
    };

    const totalEquity = fx.equity + cr.equity + shUsd.equity;
    const totalPnl = fx.pnl + cr.pnl + shUsd.pnl;
    const totalModal = fx.modalAwal + cr.modalAwal + shUsd.modalAwal;

    return { fx, cr, shIdr, shUsd, totalEquity, totalPnl, totalModal };
  }, [
    forex.cashFlows, forex.trades, forexPrices,
    crypto.cashFlows, crypto.futuresTrades, crypto.spotHoldings, cryptoPrices,
    saham.cashFlows, saham.holdings, usdIdrRate,
  ]);

  // Combined equity curve — reconstructed from each desk's closed-trade saldo_akun
  // history (no new persistence). Forex & Crypto are USD (USDT≈USD) → identity.
  // Saham exposes no per-trade balance series (equity is cash-flow + holdings
  // derived, not a running saldo_akun), so it contributes nothing to the historical
  // curve today; when it does, IDR→USD would divide by usdIdrRate like the table above.
  const combinedCurve = useMemo(() => {
    const forexClosed = forex.trades.filter(t => t.status === 'Closed');
    const cryptoClosed = crypto.futuresTrades.filter(t => t.status === 'Closed');
    const forexSeries = deskEquitySeries(forexClosed, usd => usd);
    const cryptoSeries = deskEquitySeries(cryptoClosed, usd => usd);
    return combinedEquityCurve([forexSeries, cryptoSeries]);
  }, [forex.trades, crypto.futuresTrades]);

  // "Xm ago" FX-feed staleness label is kept live by its own 30s tick (not the
  // price feed) so it stays honest even if ticks pause — but only while the
  // badge is shown (fxStatus === 'live'); otherwise the interval is cleared.
  // Declared above the loading guard so hook order stays stable (rules-of-hooks).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fxStatus !== 'live') return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [fxStatus]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading consolidated portfolio…</div>;
  }

  const pnlPct = agg.totalModal !== 0 ? (agg.totalPnl / agg.totalModal) * 100 : 0;
  const fxMins = fxUpdated != null ? Math.max(0, Math.round((now - fxUpdated) / 60000)) : null;

  const deskRows: DeskRow[] = [
    { key: 'forex', desk: 'Forex & Commodities', equity: agg.fx.equity, pnl: agg.fx.pnl, basis: 'Native USD' },
    { key: 'crypto', desk: 'Crypto', equity: agg.cr.equity, pnl: agg.cr.pnl, basis: 'USDT ≈ USD' },
    { key: 'saham', desk: 'Equities (Saham)', equity: agg.shUsd.equity, pnl: agg.shUsd.pnl, basis: `${fmtIdr(agg.shIdr.equity)} @ ${usdIdrRate.toLocaleString('en-US')}` },
  ];

  const deskColumns: Column<DeskRow>[] = [
    { key: 'desk', header: 'Desk', width: 'minmax(0,1.6fr)' },
    { key: 'equity', header: 'Equity (USD)', numeric: true, sortValue: r => r.equity, cell: r => fmtUsd(r.equity) },
    {
      key: 'pnl', header: 'P&L (USD)', numeric: true, sortValue: r => r.pnl,
      cell: r => <span className={r.pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(r.pnl)}</span>,
    },
    { key: 'basis', header: 'Basis', width: 'minmax(0,1.4fr)', cell: r => <span className="text-adm-ink-dim">{r.basis}</span> },
  ];

  const allocation = [
    { label: 'Forex', value: agg.fx.equity, color: color.desk.forex },
    { label: 'Crypto', value: agg.cr.equity, color: color.desk.crypto },
    { label: 'Saham', value: agg.shUsd.equity, color: color.desk.saham },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        desk="overview"
        title="Total AUM"
        sub="All desks consolidated · normalized to USD"
        right={
          <div className="flex items-center gap-2">
            <span className="font-adm-data text-adm-micro text-adm-ink-dim">
              USD/IDR <span className="text-adm-ink-mid">{usdIdrRate.toLocaleString('en-US')}</span>
            </span>
            <StatusBadge kind={fxStatus} detail={fxStatus === 'live' && fxMins != null ? `${fxMins}m ago` : undefined} title="USD/IDR feed" />
            <button
              onClick={fxRefresh}
              title="Refresh USD/IDR rate"
              aria-label="Refresh USD/IDR rate"
              className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', fxStatus === 'loading' && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {fxStatus === 'fallback' && (
        <p className="flex items-center gap-1.5 font-adm-data text-adm-micro text-adm-desk-forex">
          <AlertTriangle className="h-3 w-3" /> FX rate unavailable — Saham→USD uses a fallback rate (approximate)
        </p>
      )}

      <MetricStrip
        items={[
          { label: 'Total AUM', value: agg.totalEquity, format: 'usd', emphasis: true, sub: 'all desks · USD' },
          { label: 'Total P&L', value: agg.totalPnl, format: 'signedUsd', sub: `${fmtSignedPct(pnlPct)} vs modal awal` },
          { label: 'Total Modal Awal', value: agg.totalModal, format: 'usd', sub: 'net capital deployed' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <p className="mb-2 font-adm-data text-adm-micro uppercase text-adm-ink-dim">Per-desk breakdown</p>
          <DataTable columns={deskColumns} rows={deskRows} rowKey={r => r.key} density="dense" />
        </div>
        <ChartPanel type="alloc" title="Allocation by desk" note="share of AUM (USD)" segments={allocation} valueFormat={fmtUsd} />
      </div>

      {/* Market sessions — full-width schedule strip, placed below the per-desk
          breakdown and above the combined equity curve (fits the single-column
          stack of full-width sections). Self-contained: its own tz-correct
          session math + ticking clock, no dependency on the desk data above. */}
      <MarketSessionsPanel />

      {/* Combined equity curve — reconstructed from closed-trade saldo_akun history,
          forward-filled and summed across desks (Saham absent until it has trades). */}
      {combinedCurve.x.length > 0 ? (
        <ChartPanel
          type="area"
          title="Combined equity curve"
          note="closed-trade balance · all desks · USD"
          xKind="time"
          x={combinedCurve.x}
          series={[{ label: 'COMBINED EQUITY', data: combinedCurve.y, tone: 'neutral' }]}
          valueFormat={fmtUsd}
          height={240}
        />
      ) : (
        <section className="rounded-adm border border-adm-line bg-adm-bg1 p-4">
          <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Combined equity curve</h3>
          <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
            <p className="font-adm-data text-adm-sm text-adm-ink-mid">No closed trades yet</p>
            <p className="max-w-md font-adm-data text-adm-micro text-adm-ink-dim">
              The unified USD equity-over-time series appears once any desk has a closed trade with a recorded balance.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
