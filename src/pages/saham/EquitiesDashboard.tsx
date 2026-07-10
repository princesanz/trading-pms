import { useMemo } from 'react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Briefcase, DollarSign, TrendingUp, TrendingDown, Wallet, Landmark, Banknote } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { sahamDeskSummary } from '../../lib/deskAggregates';
import { useSahamPrices } from './StockPortfolio';
import { PriceStatusBadge } from '../../components/PriceStatusBadge';

export function EquitiesDashboard() {
  const { holdings, dividends, cashFlows, loading } = useEquitiesData();

  const activeHoldings = useMemo(() => holdings.filter(h => h.total_lot > 0), [holdings]);
  const { prices: livePrices, status: priceStatus, lastUpdated: priceUpdated, refresh: refreshPrices } = useSahamPrices(activeHoldings);

  const stats = useMemo(() => {
    let totalPortfolioValue = 0;
    activeHoldings.forEach(h => {
      const lp = livePrices[h.emiten]?.price;
      if (lp && lp > 0) {
        totalPortfolioValue += h.total_lot * 100 * lp;
      } else {
        totalPortfolioValue += h.total_cost_basis;
      }
    });

    const totalDividends = dividends.reduce((sum, d) => sum + (d.net_dividend || 0), 0);

    // Equity / P&L / Modal Awal via the shared desk-summary helper (native IDR) —
    // the SAME one the Overview uses, so the two can never drift.
    const desk = sahamDeskSummary(cashFlows, holdings);
    
    const liveEquity = desk.funding + desk.trading + totalPortfolioValue;
    const livePnl = liveEquity - desk.modalAwal;

    return {
      totalPortfolioValue,
      totalDividends,
      numHoldings: activeHoldings.length,
      funding: desk.funding,
      trading: desk.trading,
      modalAwal: desk.modalAwal,
      totalPnl: livePnl,
    };
  }, [activeHoldings, holdings, dividends, cashFlows, livePrices]);

  const topHoldingsData = useMemo(() =>
    activeHoldings
      .sort((a, b) => b.total_cost_basis - a.total_cost_basis)
      .slice(0, 10)
      .map(h => ({ name: h.emiten, value: h.total_cost_basis })),
  [activeHoldings]);

  const dividendByMonth = useMemo(() => {
    const map = new Map<string, number>();
    dividends.forEach(d => {
      const month = format(parseISO(d.tanggal_pembayaran), 'yyyy-MM');
      map.set(month, (map.get(month) || 0) + (d.net_dividend || 0));
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, total]) => ({ month: format(parseISO(month + '-01'), 'MMM yy'), total }));
  }, [dividends]);

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading equities data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Equities Overview</h2>
        <PriceStatusBadge status={priceStatus} lastUpdated={priceUpdated} onRefresh={refreshPrices} />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Modal Awal" value={`Rp${stats.modalAwal.toLocaleString()}`} subtitle="Net capital in/out" icon={<Banknote className="text-purple-500" />} />
        <StatCard title="Funding Account" value={`Rp${stats.funding.toLocaleString()}`} subtitle="External deposits" icon={<Landmark className="text-purple-500" />} />
        <StatCard title="Trading Account" value={`Rp${stats.trading.toLocaleString()}`} subtitle="Available to trade" icon={<Wallet className="text-purple-500" />} />
        <StatCard title="Portfolio Value" value={`Rp${stats.totalPortfolioValue.toLocaleString()}`} subtitle="Live value" icon={<Briefcase className="text-amber-500" />} />
        <StatCard title="Total P&L" value={`${stats.totalPnl >= 0 ? '+' : '-'}Rp${Math.abs(stats.totalPnl).toLocaleString()}`} subtitle="Equity − Modal Awal" valueClass={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} icon={stats.totalPnl >= 0 ? <TrendingUp className="text-emerald-500" /> : <TrendingDown className="text-rose-500" />} />
        <StatCard title="Total Dividends" value={`Rp${stats.totalDividends.toLocaleString()}`} subtitle={`${dividends.length} entries`} icon={<DollarSign className="text-emerald-500" />} />
        <StatCard title="Active Holdings" value={stats.numHoldings.toString()} icon={<TrendingUp className="text-blue-500" />} />
      </div>

      {/* Top Holdings + Dividend Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-4">Top Holdings by Cost Basis</h3>
          <div className="h-64">
            {topHoldingsData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topHoldingsData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#64748b" tickFormatter={val => `Rp${(val / 1_000_000).toFixed(1)}M`} />
                  <YAxis type="category" dataKey="name" stroke="#64748b" width={60} tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} formatter={(val: any) => [`Rp${Number(val).toLocaleString()}`, 'Cost Basis']} />
                  <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">No holdings yet.</div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-4">Dividend Income Timeline</h3>
          <div className="h-64">
            {dividendByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dividendByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#64748b" tickFormatter={val => `Rp${(val / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} formatter={(val: any) => [`Rp${Number(val).toLocaleString()}`, 'Net Dividend']} />
                  <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">No dividend data yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, valueClass }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; valueClass?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">{icon}</div>
      <div>
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <p className={`text-xl font-bold tracking-tight ${valueClass ?? 'text-slate-100'}`}>{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
