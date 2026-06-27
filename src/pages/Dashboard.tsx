import { useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Target, Wallet, Landmark, Banknote } from 'lucide-react';
import { format, parseISO, getDay } from 'date-fns';
import { cn } from '../lib/utils';
import { useForexPrices } from '../contexts/ForexPriceProvider';
import { forexDeskSummary } from '../lib/deskAggregates';
import { PriceStatusBadge } from '../components/PriceStatusBadge';

export function Dashboard() {
  const { trades, cashFlows, settings, loading } = usePortfolioData();
  const { prices, status, lastUpdated, refresh } = useForexPrices();

  // Equity / P&L / Modal Awal via the shared desk-summary helper — the SAME one the
  // Overview uses, so the two can never drift. Aliased to keep the existing card
  // references (balances.funding, totalEquity, totalPnl, modalAwal) working unchanged.
  const summary = useMemo(() => forexDeskSummary(cashFlows, trades, prices), [cashFlows, trades, prices]);
  const balances = summary;
  const modalAwal = summary.modalAwal;
  const totalEquity = summary.equity;
  const totalPnl = summary.pnl;

  // Filter to only closed trades for all dashboard analytics
  const closedTrades = useMemo(() => trades.filter(t => t.status === 'Closed'), [trades]);

  const stats = useMemo(() => {
    const wonTrades = closedTrades.filter(t => (t.net_pnl || 0) > 0);
    const lostTrades = closedTrades.filter(t => (t.net_pnl || 0) < 0);
    const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;

    // Max Drawdown: largest peak-to-trough decline in saldo_akun among closed trades
    let peak = settings?.modal_awal || 0;
    let maxDrawdown = 0;
    
    closedTrades.forEach(t => {
      const balance = t.saldo_akun || 0;
      if (balance > peak) peak = balance;
      if (peak > 0) {
        const drawdown = ((peak - balance) / peak) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
    });

    return {
      winRate,
      maxDrawdown,
      totalClosed: closedTrades.length,
      totalOpen: trades.length - closedTrades.length,
      wonCount: wonTrades.length,
      lostCount: lostTrades.length,
    };
  }, [closedTrades, trades, settings]);

  // Equity curve only from closed trades (they have saldo_akun populated)
  const chartData = useMemo(() => {
    return closedTrades
      .filter(t => t.saldo_akun != null)
      .map(t => ({
        date: t.tanggal,
        balance: t.saldo_akun,
        pnl: t.net_pnl,
        instrument: t.instrumen,
        psychology: t.psychology_tag?.name || 'Unknown'
      }));
  }, [closedTrades]);

  const pnlByDay = useMemo(() => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const result = days.map(day => ({ day, profit: 0, loss: 0 }));
    
    closedTrades.forEach(t => {
      if (t.net_pnl) {
        const dayIdx = getDay(parseISO(t.tanggal));
        if (t.net_pnl > 0) result[dayIdx].profit += t.net_pnl;
        else result[dayIdx].loss += Math.abs(t.net_pnl);
      }
    });
    // Return only Mon-Fri
    return result.slice(1, 6);
  }, [closedTrades]);

  const psychologyInsights = useMemo(() => {
    const psychMap = new Map<string, { total: number; wins: number }>();
    
    closedTrades.forEach(t => {
      if (t.net_pnl === null || t.net_pnl === undefined) return;
      const psychName = t.psychology_tag?.name || 'Unknown';
      const isWin = t.net_pnl > 0;
      
      const current = psychMap.get(psychName) || { total: 0, wins: 0 };
      psychMap.set(psychName, {
        total: current.total + 1,
        wins: current.wins + (isWin ? 1 : 0)
      });
    });

    return Array.from(psychMap.entries()).map(([name, data]) => ({
      name,
      total: data.total,
      winRate: (data.wins / data.total) * 100,
      wins: data.wins,
      losses: data.total - data.wins
    })).sort((a, b) => b.total - a.total);
  }, [closedTrades]);

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading portfolio data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
        <div className="flex items-center gap-3">
          {stats.totalOpen > 0 && (
            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-1 rounded">
              {stats.totalOpen} open trade{stats.totalOpen > 1 ? 's' : ''}
            </span>
          )}
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
        </div>
      </div>
      
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Modal Awal"
          value={`$${modalAwal.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
          subtitle="Net capital in/out"
          icon={<Banknote className="text-emerald-500" />}
        />
        <StatCard
          title="Funding Account"
          value={`$${balances.funding.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
          subtitle="External deposits"
          icon={<Landmark className="text-emerald-500" />}
        />
        <StatCard
          title="Trading Account"
          value={`$${balances.trading.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
          subtitle="Available to trade"
          icon={<Wallet className="text-emerald-500" />}
        />
        <StatCard
          title="Total Equity"
          value={`$${totalEquity.toLocaleString(undefined, {minimumFractionDigits: 2})}`}
          subtitle="Funding + Trading + open uPnL (live)"
          icon={<Activity className="text-emerald-500" />}
        />
        <StatCard
          title="Total P&L"
          value={`${totalPnl >= 0 ? '+' : '-'}$${Math.abs(totalPnl).toLocaleString(undefined, {minimumFractionDigits: 2})}`}
          subtitle="Equity − Modal Awal"
          valueClass={totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          icon={totalPnl >= 0 ? <TrendingUp className="text-emerald-500" /> : <TrendingDown className="text-rose-500" />}
        />
        <StatCard
          title="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          subtitle={`${stats.wonCount}W / ${stats.lostCount}L`}
          icon={<Target className="text-blue-500" />}
        />
        <StatCard 
          title="Max Drawdown" 
          value={`${stats.maxDrawdown.toFixed(2)}%`}
          icon={<TrendingDown className="text-rose-500" />}
        />
        <StatCard 
          title="Closed Trades" 
          value={stats.totalClosed.toString()}
          icon={<TrendingUp className="text-purple-500" />}
        />
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Equity Curve */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
          <div className="h-72">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" tickFormatter={(val) => format(parseISO(val), 'MMM dd')} />
                  <YAxis stroke="#64748b" domain={['auto', 'auto']} tickFormatter={(val) => `$${val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                    itemStyle={{ color: '#10b981' }}
                  />
                  <Line type="monotone" dataKey="balance" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                Close some trades to see the equity curve.
              </div>
            )}
          </div>
        </div>

        {/* Win/Loss Donut */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-4">Win vs Loss</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Wins', value: stats.wonCount },
                    { name: 'Losses', value: stats.lostCount }
                  ]}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#f43f5e" />
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2 text-sm">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div>Wins ({stats.wonCount})</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500"></div>Losses ({stats.lostCount})</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PnL By Day of Week */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-lg font-medium mb-4">PnL by Day of Week</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pnlByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} cursor={{fill: '#1e293b'}} />
                <Bar dataKey="profit" fill="#10b981" stackId="a" />
                <Bar dataKey="loss" fill="#f43f5e" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Psychology Insights Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-hidden flex flex-col">
          <h3 className="text-lg font-medium mb-4 text-emerald-400 flex items-center gap-2">
            <Target className="w-5 h-5" />
            Psychology Edge Analysis
          </h3>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Psychology State</th>
                  <th className="px-4 py-3 text-right">Trades</th>
                  <th className="px-4 py-3 text-right rounded-tr-lg">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {psychologyInsights.map((item) => (
                  <tr key={item.name} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                    <td className="px-4 py-3 font-medium text-slate-200">{item.name}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{item.total}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        "px-2 py-1 rounded-md font-bold",
                        item.winRate >= 50 ? "text-emerald-400 bg-emerald-400/10" : "text-rose-400 bg-rose-400/10"
                      )}>
                        {item.winRate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
                {psychologyInsights.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-500">No psychology data available yet. Close some trades to see insights.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, valueClass }: { title: string; value: string; subtitle?: string; icon: React.ReactNode; valueClass?: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex items-center gap-4">
      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-400">{title}</p>
        <p className={`text-2xl font-bold tracking-tight ${valueClass ?? 'text-slate-100'}`}>{value}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
