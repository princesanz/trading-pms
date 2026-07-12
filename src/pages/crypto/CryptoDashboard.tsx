import { useMemo } from 'react';
import { useCryptoData } from '../../hooks/useCryptoData';
import { calculateDeskBalances, calculateEffectiveTradingBalance, calculateNetCapital } from '../../lib/balanceCalc';
import { cryptoDeskSummary } from '../../lib/deskAggregates';
import { winLossStats, maxDrawdownPct, groupedWinRates, pnlByWeekday, spotInvested } from '../../lib/tradeStats';
import { useCryptoPolling, useCryptoPriceMap, useCryptoFeedMeta, refreshCrypto } from '../../state/prices';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge } from '../../components/adm/StatusBadge';
import { MetricStrip } from '../../components/adm/MetricStrip';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { ChartPanel } from '../../components/adm/ChartPanel';
import { color } from '../../design/tokens';
import { fmtUsd, fmtSignedUsd, fmtPct } from '../../design/format';
import type { CryptoFuturesTrade, CryptoSpotHolding, CashFlow } from '../../types';

/**
 * Live cells — the ONLY subscribers to the crypto price store on this page.
 * Equity/P&L depend on live spot valuations + futures uPnL, so they re-render
 * on the 5s tick; everything else (realized stats, charts) does not. Both call
 * the SAME cryptoDeskSummary the Overview uses — no new math, no animation.
 */
function LiveEquityCell({ cashFlows, futuresTrades, spotHoldings }: { cashFlows: CashFlow[]; futuresTrades: CryptoFuturesTrade[]; spotHoldings: CryptoSpotHolding[] }) {
  const prices = useCryptoPriceMap();
  const { equity } = cryptoDeskSummary(cashFlows, futuresTrades, spotHoldings, prices);
  return <span className="text-adm-ink-hi">{fmtUsd(equity)}</span>;
}

function LivePnlCell({ cashFlows, futuresTrades, spotHoldings }: { cashFlows: CashFlow[]; futuresTrades: CryptoFuturesTrade[]; spotHoldings: CryptoSpotHolding[] }) {
  const prices = useCryptoPriceMap();
  const { pnl } = cryptoDeskSummary(cashFlows, futuresTrades, spotHoldings, prices);
  return <span className={pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(pnl)}</span>;
}

type PsychRow = { name: string; total: number; winRate: number; wins: number; losses: number };

export function CryptoDashboard() {
  useCryptoPolling();
  const { futuresTrades, spotHoldings, cashFlows, settings, loading } = useCryptoData();
  const feed = useCryptoFeedMeta();

  // Realized balances (no live prices) — same lib calls cryptoDeskSummary composes.
  const funding = useMemo(() => calculateDeskBalances(cashFlows, 'Crypto').funding, [cashFlows]);
  const trading = useMemo(() => calculateEffectiveTradingBalance(cashFlows, 'Crypto', futuresTrades), [cashFlows, futuresTrades]);
  const modalAwal = useMemo(() => calculateNetCapital(cashFlows, 'Crypto'), [cashFlows]);

  const closedTrades = useMemo(() => futuresTrades.filter(t => t.status === 'Closed'), [futuresTrades]);

  const stats = useMemo(() => {
    const { winRate, wonCount, lostCount, totalClosed } = winLossStats(closedTrades);
    const maxDrawdown = maxDrawdownPct(closedTrades, settings?.modal_awal_crypto || 0);
    return {
      winRate, maxDrawdown, totalClosed,
      totalOpen: futuresTrades.length - closedTrades.length,
      wonCount, lostCount,
      spotInvested: spotInvested(spotHoldings),
    };
  }, [closedTrades, futuresTrades, spotHoldings, settings]);

  const chartData = useMemo(
    () => closedTrades.filter(t => t.saldo_akun != null).map(t => ({ date: t.tanggal, balance: t.saldo_akun as number })),
    [closedTrades]
  );
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

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading crypto data…</div>;

  const feedSecs = feed.lastUpdated != null ? Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000)) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="crypto"
        title="Crypto Desk"
        sub="futures & spot"
        commandHint
        right={
          <div className="flex items-center gap-2">
            {stats.totalOpen > 0 && <StatusBadge kind="open" label={`${stats.totalOpen} OPEN`} />}
            <StatusBadge kind={feed.status} detail={feed.status === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined} title="Binance feed" />
            <button onClick={refreshCrypto} title="Refresh prices" aria-label="Refresh prices" className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2">
              <RefreshCw className={cn('h-3.5 w-3.5', feed.status === 'loading' && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* Capital strip — equity & P&L live (tick-updated, never animated). */}
      <MetricStrip
        items={[
          { label: 'Modal Awal', value: modalAwal, format: 'usd', sub: 'net capital in/out' },
          { label: 'Funding', value: funding, format: 'usd', sub: 'external deposits' },
          { label: 'Trading', value: trading, format: 'usd', sub: 'futures cash + realized' },
          { label: 'Total Equity', value: <LiveEquityCell cashFlows={cashFlows} futuresTrades={futuresTrades} spotHoldings={spotHoldings} />, format: 'raw', emphasis: true, sub: 'incl. spot + uPnL (live)' },
          { label: 'Total P&L', value: <LivePnlCell cashFlows={cashFlows} futuresTrades={futuresTrades} spotHoldings={spotHoldings} />, format: 'raw', sub: 'equity − modal awal' },
        ]}
      />

      {/* Performance strip — realized only, never re-renders on a tick. */}
      <MetricStrip
        items={[
          { label: 'Spot invested', value: stats.spotInvested, format: 'usd', tone: 'neutral', sub: 'cost basis' },
          { label: 'Win rate', value: stats.winRate, format: 'pct', tone: 'neutral', sub: `${stats.wonCount}W / ${stats.lostCount}L` },
          { label: 'Max drawdown', value: `${stats.maxDrawdown.toFixed(2)}%`, tone: 'neutral', sub: 'peak-to-trough' },
          { label: 'Closed futures', value: String(stats.totalClosed), tone: 'neutral' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartPanel
          type="area"
          title="Futures equity curve"
          note="daily closing balance (realized)"
          x={curve.x}
          series={[{ label: 'BAL', data: curve.y, tone: 'crypto' }]}
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
          note="closed futures, absolute loss"
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
            empty="No psychology data yet — close some futures trades."
          />
        </div>
      </div>
    </div>
  );
}
