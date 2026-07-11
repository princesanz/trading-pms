import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { sahamDeskSummary } from '../../lib/deskAggregates';
import { useSahamPrices } from './StockPortfolio';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge, type BadgeKind } from '../../components/adm/StatusBadge';
import { MetricStrip } from '../../components/adm/MetricStrip';
import { ChartPanel } from '../../components/adm/ChartPanel';
import { fmtIdr } from '../../design/format';

/** Maps the saham price feed status onto a StatusBadge kind (1:1 names, but the
 *  badge type is explicit so a feed-status rename can't silently break). */
const FEED_KIND: Record<string, BadgeKind> = { live: 'live', stale: 'stale', error: 'error', loading: 'loading' };

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

  const topHoldings = useMemo(() =>
    activeHoldings
      .slice()
      .sort((a, b) => b.total_cost_basis - a.total_cost_basis)
      .slice(0, 10),
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

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading equities data…</div>;

  const feedSecs = priceUpdated != null ? Math.max(0, Math.round((Date.now() - priceUpdated) / 1000)) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="saham"
        title="Equities Desk"
        sub="stocks · dividends"
        commandHint
        right={
          <div className="flex items-center gap-2">
            {stats.numHoldings > 0 && <StatusBadge kind="open" label={`${stats.numHoldings} HELD`} />}
            <StatusBadge
              kind={FEED_KIND[priceStatus] ?? 'loading'}
              detail={priceStatus === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined}
              title="Market-proxy feed"
            />
            <button
              onClick={refreshPrices}
              title="Refresh prices"
              aria-label="Refresh prices"
              className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', priceStatus === 'loading' && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* Capital strip — IDR. Portfolio value & P&L reflect the live feed (60s
          poll); a poll is a discrete refresh, so numbers swap, never animate. */}
      <MetricStrip
        items={[
          { label: 'Modal Awal', value: stats.modalAwal, format: 'idr', sub: 'net capital in/out' },
          { label: 'Funding', value: stats.funding, format: 'idr', sub: 'external deposits' },
          { label: 'Trading', value: stats.trading, format: 'idr', sub: 'available to trade' },
          { label: 'Portfolio Value', value: stats.totalPortfolioValue, format: 'idr', emphasis: true, sub: 'live (cost basis if unpriced)' },
          { label: 'Total P&L', value: stats.totalPnl, format: 'signedIdr', sub: 'equity − modal awal' },
        ]}
      />

      {/* Performance strip — realized only, never re-renders on a tick. */}
      <MetricStrip
        items={[
          { label: 'Active holdings', value: String(stats.numHoldings), tone: 'neutral' },
          { label: 'Total dividends', value: stats.totalDividends, format: 'idr', tone: 'neutral', sub: `${dividends.length} entries` },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          type="bars"
          title="Top holdings by cost basis"
          note={`${topHoldings.length} shown`}
          x={topHoldings.map((_, i) => i)}
          xKind="category"
          xLabels={topHoldings.map(h => h.emiten)}
          series={[{ label: 'COST', data: topHoldings.map(h => h.total_cost_basis), tone: 'saham' }]}
          valueFormat={n => fmtIdr(n)}
          height={280}
        />
        <ChartPanel
          type="bars"
          title="Dividend income timeline"
          note={dividendByMonth.length > 0 ? `last ${dividendByMonth.length} mo` : 'no data'}
          x={dividendByMonth.map((_, i) => i)}
          xKind="category"
          xLabels={dividendByMonth.map(d => d.month)}
          series={[{ label: 'NET DIV', data: dividendByMonth.map(d => d.total), tone: 'up' }]}
          valueFormat={n => fmtIdr(n)}
          height={280}
        />
      </div>
    </div>
  );
}
