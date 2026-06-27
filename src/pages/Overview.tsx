import { useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { useCryptoData } from '../hooks/useCryptoData';
import { useEquitiesData } from '../hooks/useEquitiesData';
import { useForexPrices } from '../contexts/ForexPriceProvider';
import { useCryptoPrices } from '../contexts/CryptoPriceProvider';
import { useFxRate } from '../contexts/FxRateProvider';
import { useAuth } from '../contexts/AuthProvider';
import { forexDeskSummary, cryptoDeskSummary, sahamDeskSummary } from '../lib/deskAggregates';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Wallet, TrendingUp, TrendingDown, Banknote, RefreshCw, AlertTriangle, LineChart, Coins, Briefcase } from 'lucide-react';
import { cn } from '../lib/utils';
import { GoldLanding } from './public/gold/GoldLanding';

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const idr = (n: number) => `Rp${Math.round(n).toLocaleString()}`;

/**
 * Admin reads raw tables (full detail + live prices). Public visitors get the
 * gold landing, which reads only the curated public_* views (swappable design).
 */
export function Overview() {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminOverview /> : <PublicOverview />;
}

function PublicOverview() {
  return <GoldLanding />;
}

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

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading consolidated portfolio…</div>;

  const pnlPct = agg.totalModal !== 0 ? (agg.totalPnl / agg.totalModal) * 100 : 0;
  const fxMins = fxUpdated != null ? Math.max(0, Math.round((Date.now() - fxUpdated) / 60000)) : null;

  const allocation = [
    { name: 'Forex', value: agg.fx.equity, color: '#34d399' },
    { name: 'Crypto', value: agg.cr.equity, color: '#22d3ee' },
    { name: 'Saham', value: agg.shUsd.equity, color: '#fbbf24' },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Total AUM Overview</h2>
        <p className="text-slate-400 text-sm mt-1">All desks consolidated, normalized to USD.</p>
      </div>

      {/* FX rate caption */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-slate-400">
          USD/IDR <span className="text-slate-200 font-medium">{usdIdrRate.toLocaleString()}</span>
          {fxStatus === 'live' && fxMins != null && <span className="text-slate-500"> · updated {fxMins}m ago</span>}
          {fxStatus === 'stale' && <span className="text-amber-400"> · stale</span>}
        </span>
        {fxStatus === 'fallback' && (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertTriangle className="w-3 h-3" /> FX rate unavailable — Saham→USD is approximate (fallback rate)
          </span>
        )}
        <button
          onClick={fxRefresh}
          title="Refresh USD/IDR rate"
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 rounded transition-colors"
        >
          <RefreshCw className={cn('w-3 h-3', fxStatus === 'loading' && 'animate-spin')} /> Refresh FX
        </button>
      </div>

      {/* Top summary row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BigCard title="Total AUM" value={usd(agg.totalEquity)} subtitle="All desks, in USD" icon={<Wallet className="text-emerald-500" />} />
        <BigCard
          title="Total P&L"
          value={`${agg.totalPnl >= 0 ? '+' : '-'}${usd(Math.abs(agg.totalPnl))}`}
          subtitle={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% vs Modal Awal`}
          valueClass={agg.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          icon={agg.totalPnl >= 0 ? <TrendingUp className="text-emerald-500" /> : <TrendingDown className="text-rose-500" />}
        />
        <BigCard title="Total Modal Awal" value={usd(agg.totalModal)} subtitle="Net capital deployed, in USD" icon={<Banknote className="text-emerald-500" />} />
      </div>

      {/* Per-desk breakdown + allocation donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <DeskCard title="Forex & Commodities" icon={<LineChart className="text-emerald-400" />} equity={usd(agg.fx.equity)} pnl={agg.fx.pnl} note="Native USD" />
          <DeskCard title="Crypto" icon={<Coins className="text-cyan-400" />} equity={usd(agg.cr.equity)} pnl={agg.cr.pnl} note="Native USDT ≈ USD" />
          <DeskCard title="Equities (Saham)" icon={<Briefcase className="text-amber-400" />} equity={usd(agg.shUsd.equity)} pnl={agg.shUsd.pnl} note={`${idr(agg.shIdr.equity)} @ ${usdIdrRate.toLocaleString()}`} />
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-2">Allocation by Desk</h3>
          <p className="text-xs text-slate-500 mb-2">Share of Total AUM (USD)</p>
          <div className="h-60">
            {allocation.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={4}>
                    {allocation.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} formatter={(val: any) => [usd(Number(val)), 'Equity']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">No positive equity to allocate.</div>
            )}
          </div>
          <div className="flex flex-col gap-1 mt-2 text-xs">
            {allocation.map(d => {
              const pct = agg.totalEquity > 0 ? (d.value / agg.totalEquity) * 100 : 0;
              return (
                <div key={d.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </span>
                  <span className="text-slate-400">{pct.toFixed(1)}% · {usd(d.value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Combined equity curve — deferred (needs cross-desk total-equity time series). */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="text-lg font-medium mb-4">Combined Equity Curve</h3>
        <div className="h-56 flex flex-col items-center justify-center gap-2 text-slate-500">
          <LineChart className="w-8 h-8 opacity-40" />
          <p className="text-sm">Coming soon</p>
          <p className="text-xs text-slate-600 max-w-md text-center">
            A unified USD equity-over-time curve across all desks will land in a later update.
          </p>
        </div>
      </div>
    </div>
  );
}

function BigCard({ title, value, subtitle, icon, valueClass }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; valueClass?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex items-center gap-4">
      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">{icon}</div>
      <div>
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <p className={`text-2xl font-bold tracking-tight ${valueClass ?? 'text-slate-100'}`}>{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function DeskCard({ title, icon, equity, pnl, note }: { title: string; icon: React.ReactNode; equity: string; pnl: number; note: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">{icon}</div>
        <span className="text-sm font-medium text-slate-300">{title}</span>
      </div>
      <p className="text-xl font-bold tracking-tight text-slate-100">{equity}</p>
      <p className={cn('text-sm font-medium mt-1', pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} P&L
      </p>
      <p className="text-xs text-slate-500 mt-1">{note}</p>
    </div>
  );
}
