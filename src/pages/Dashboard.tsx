import { useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { calculateDeskBalances, calculateEffectiveTradingBalance, calculateNetCapital } from '../lib/balanceCalc';
import { forexLiveEquity } from '../lib/forexLivePnl';
import { winLossStats, maxDrawdownPct, groupedWinRates, pnlByWeekday } from '../lib/tradeStats';
import { useForexPolling, useForexPriceMap, useForexFeedMeta, refreshForex } from '../state/prices';
import { PageHeader } from '../components/adm/PageHeader';
import { StatusBadge } from '../components/adm/StatusBadge';
import { MetricStrip } from '../components/adm/MetricStrip';
import { DataTable, type Column } from '../components/adm/DataTable';
import { ChartPanel } from '../components/adm/ChartPanel';
import { color } from '../design/tokens';
import { fmtUsd, fmtSignedUsd, fmtPct } from '../design/format';
import type { Trade } from '../types';

// Bucket timestamps by the user's LOCAL (WIB) calendar day. Timestamps are stored in UTC,
// so a trade closed 01:00 WIB must count as that WIB day, not the prior UTC day. We derive
// the day via Intl (timeZone) rather than hardcoding a +7 offset. `en-CA` yields YYYY-MM-DD.
const WIB_TZ = 'Asia/Jakarta';
function wibDayKey(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: WIB_TZ });
}

/**
 * Live cells — the ONLY components on this page subscribed to the price store.
 * A 5s tick re-renders these two spans; the charts, tables, and realized
 * metrics never re-render on a tick. Math is the same lib composition
 * forexDeskSummary uses (forexLiveEquity over the realized balances); values
 * swap with NO animation per the motion rule.
 */
function LiveEquityCell({ funding, trading, openTrades }: { funding: number; trading: number; openTrades: Trade[] }) {
  const prices = useForexPriceMap();
  return <span className="text-adm-ink-hi">{fmtUsd(forexLiveEquity(funding, trading, openTrades, prices))}</span>;
}

function LivePnlCell({ funding, trading, modalAwal, openTrades }: { funding: number; trading: number; modalAwal: number; openTrades: Trade[] }) {
  const prices = useForexPriceMap();
  const pnl = forexLiveEquity(funding, trading, openTrades, prices) - modalAwal;
  return <span className={pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(pnl)}</span>;
}

type PsychRow = { name: string; total: number; winRate: number; wins: number; losses: number };

export function Dashboard() {
  useForexPolling();
  const { trades, cashFlows, settings, loading } = usePortfolioData();
  const feed = useForexFeedMeta();

  // Same balance composition as forexDeskSummary (lib/deskAggregates), decomposed
  // so the price-dependent term lives only in the live cells above.
  const funding = useMemo(() => calculateDeskBalances(cashFlows, 'Forex').funding, [cashFlows]);
  const trading = useMemo(() => calculateEffectiveTradingBalance(cashFlows, 'Forex', trades), [cashFlows, trades]);
  const modalAwal = useMemo(() => calculateNetCapital(cashFlows, 'Forex'), [cashFlows]);
  const openTrades = useMemo(() => trades.filter(t => t.status === 'Open'), [trades]);

  // Filter to only closed trades for all dashboard analytics
  const closedTrades = useMemo(() => trades.filter(t => t.status === 'Closed'), [trades]);

  // Formula extraction (redesign Phase 0): the math lives in lib/tradeStats.ts.
  const stats = useMemo(() => {
    const { winRate, wonCount, lostCount, totalClosed } = winLossStats(closedTrades);
    const maxDrawdown = maxDrawdownPct(closedTrades, settings?.modal_awal || 0);
    return { winRate, maxDrawdown, totalClosed, totalOpen: trades.length - closedTrades.length, wonCount, lostCount };
  }, [closedTrades, trades, settings]);

  // Equity curve: ONE point per WIB trading day (daily closing balance), not one per trade.
  // closedTrades arrives in ascending replay order (the same order forexBalances.ts accumulates
  // saldo_akun), so within each close-day the LAST write wins = end-of-day cumulative realized
  // balance. Balance values are taken verbatim from saldo_akun — no recomputation here.
  const chartData = useMemo(() => {
    const byDay = new Map<string, { date: string; balance: number }>();
    for (const t of closedTrades) {
      if (t.saldo_akun == null) continue;
      // Bucket by close date; fall back to the open date for legacy rows without tanggal_tutup.
      const day = wibDayKey(t.tanggal_tutup || t.tanggal);
      byDay.set(day, { date: day, balance: t.saldo_akun });
    }
    return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [closedTrades]);

  const curve = useMemo(() => ({
    x: chartData.map(d => Math.floor(Date.parse(d.date) / 1000)),
    y: chartData.map(d => d.balance),
  }), [chartData]);

  const pnlByDay = useMemo(() => pnlByWeekday(closedTrades), [closedTrades]);

  const psychologyInsights = useMemo(
    () => groupedWinRates(closedTrades, t => t.psychology_tag?.name || 'Unknown'),
    [closedTrades]
  );

  const psychColumns: Column<PsychRow>[] = [
    { key: 'name', header: 'Psychology state', width: 'minmax(0,1.6fr)' },
    { key: 'total', header: 'Trades', numeric: true, width: '90px', sortValue: r => r.total },
    { key: 'wins', header: 'W/L', numeric: true, width: '90px', cell: r => <span className="text-adm-ink-mid">{r.wins}/{r.losses}</span> },
    {
      key: 'winRate', header: 'Win rate', numeric: true, width: '110px', sortValue: r => r.winRate,
      cell: r => <span className={r.winRate >= 50 ? 'text-adm-up' : 'text-adm-down'}>{fmtPct(r.winRate)}</span>,
    },
  ];

  if (loading) {
    return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading portfolio data…</div>;
  }

  const feedMins = feed.lastUpdated != null ? Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000)) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="forex"
        title="Forex & Commodities"
        sub="XAUUSD · majors · indices"
        right={
          <div className="flex items-center gap-2">
            {stats.totalOpen > 0 && <StatusBadge kind="open" label={`${stats.totalOpen} OPEN`} />}
            <StatusBadge kind={feed.status} detail={feed.status === 'live' && feedMins != null ? `${feedMins}s ago` : undefined} title="gold-api feed" />
            <button
              onClick={refreshForex}
              title="Refresh prices"
              aria-label="Refresh prices"
              className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', feed.status === 'loading' && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* Capital strip — equity & P&L are live (tick-updated, never animated). */}
      <MetricStrip
        items={[
          { label: 'Modal Awal', value: modalAwal, format: 'usd', sub: 'net capital in/out' },
          { label: 'Funding', value: funding, format: 'usd', sub: 'external deposits' },
          { label: 'Trading', value: trading, format: 'usd', sub: 'cash + realized P&L' },
          { label: 'Total Equity', value: <LiveEquityCell funding={funding} trading={trading} openTrades={openTrades} />, format: 'raw', emphasis: true, sub: 'incl. live uPnL' },
          { label: 'Total P&L', value: <LivePnlCell funding={funding} trading={trading} modalAwal={modalAwal} openTrades={openTrades} />, format: 'raw', sub: 'equity − modal awal' },
        ]}
      />

      {/* Performance strip — realized only, never re-renders on a tick. */}
      <MetricStrip
        items={[
          { label: 'Win rate', value: stats.winRate, format: 'pct', tone: 'neutral', sub: `${stats.wonCount}W / ${stats.lostCount}L` },
          { label: 'Max drawdown', value: `${stats.maxDrawdown.toFixed(2)}%`, tone: 'neutral', sub: 'peak-to-trough, saldo akun' },
          { label: 'Closed trades', value: String(stats.totalClosed), tone: 'neutral' },
          { label: 'Open positions', value: String(stats.totalOpen), tone: 'neutral' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartPanel
          type="area"
          title="Equity curve"
          note="daily closing balance (realized)"
          x={curve.x}
          series={[{ label: 'BAL', data: curve.y, tone: 'neutral' }]}
          valueFormat={n => fmtUsd(n)}
          height={280}
          className="lg:col-span-2"
        />
        <ChartPanel
          type="alloc"
          title="Win vs loss"
          note={`${stats.totalClosed} closed`}
          segments={[
            { label: 'Wins', value: stats.wonCount, color: color.up },
            { label: 'Losses', value: stats.lostCount, color: color.down },
          ]}
          valueFormat={n => String(Math.round(n))}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          type="bars"
          title="P&L by weekday"
          note="closed trades, absolute loss"
          x={[0, 1, 2, 3, 4]}
          xKind="category"
          xLabels={pnlByDay.map(d => d.day.slice(0, 3).toUpperCase())}
          series={[
            { label: 'PROFIT', data: pnlByDay.map(d => d.profit), tone: 'up' },
            { label: 'LOSS', data: pnlByDay.map(d => d.loss), tone: 'down' },
          ]}
          valueFormat={n => fmtUsd(n)}
          height={240}
        />
        <div>
          <p className="mb-2 font-adm-data text-adm-micro uppercase text-adm-ink-dim">Psychology edge analysis</p>
          <DataTable
            columns={psychColumns}
            rows={psychologyInsights}
            rowKey={r => r.name}
            defaultSort={{ key: 'total', dir: 'desc' }}
            empty="No psychology data yet — close some trades to see insights."
          />
        </div>
      </div>
    </div>
  );
}

