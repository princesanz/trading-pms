import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { cn } from '../../lib/utils';
import type { PriceStatus } from '../../components/PriceStatusBadge';
import type { StockHolding } from '../../types';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge, type BadgeKind } from '../../components/adm/StatusBadge';
import { MetricStrip } from '../../components/adm/MetricStrip';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { fmtIdr, fmtSignedIdr, fmtSignedPct } from '../../design/format';

export type SahamPriceFeed = {
  prices: Record<string, { price: number, changePercent: number | null }>;
  status: PriceStatus;
  lastUpdated: number | null; // epoch ms of last successful fetch
  refresh: () => void;
};

export function useSahamPrices(activeHoldings: StockHolding[]): SahamPriceFeed {
  const [fetchedPrices, setFetchedPrices] = useState<Record<string, { price: number, changePercent: number | null }>>({});
  // Feed status mirrors the Forex/Crypto providers so the shared PriceStatusBadge behaves
  // identically across desks: loading → live on success; stale if a later poll fails after we
  // already had data; error if we never got any.
  const [status, setStatus] = useState<PriceStatus>('loading');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const hasDataRef = useRef(false);

  const fetchPrices = useCallback(async () => {
    // Build a map of Yahoo symbol → original emiten key
    const symbolToEmiten = new Map<string, string>();
    activeHoldings.forEach(h => {
      let yahooSymbol: string;
      switch (h.market ?? 'IDX') {
        case 'IDX':
          yahooSymbol = h.emiten.includes('.') ? h.emiten : `${h.emiten}.JK`;
          break;
        case 'CRYPTO':
          yahooSymbol = h.emiten.includes('-') ? h.emiten : `${h.emiten}-USD`;
          break;
        case 'US':
        default:
          yahooSymbol = h.emiten;
          break;
      }
      symbolToEmiten.set(yahooSymbol, h.emiten);
    });

    const uniqueSymbols = Array.from(symbolToEmiten.keys());
    if (uniqueSymbols.length === 0) return;

    try {
      const res = await fetch(`/api/market-proxy?symbols=${uniqueSymbols.join(',')}`);
      if (!res.ok) {
        setStatus(hasDataRef.current ? 'stale' : 'error');
        return;
      }
      const data = await res.json();

      const newPrices: Record<string, { price: number, changePercent: number | null }> = {};
      data.forEach((q: any) => {
        if (q.price != null) {
          const emiten = symbolToEmiten.get(q.symbol) ?? q.symbol;
          newPrices[emiten] = { price: q.price, changePercent: q.changePercent };
        }
      });
      setFetchedPrices(prev => ({ ...prev, ...newPrices }));
      hasDataRef.current = true;
      setLastUpdated(Date.now());
      setStatus('live');
    } catch (err) {
      console.error('Failed to fetch saham prices', err);
      setStatus(hasDataRef.current ? 'stale' : 'error');
    }
  }, [activeHoldings]);

  useEffect(() => {
    if (activeHoldings.length === 0) return;
    fetchPrices();
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, [activeHoldings, fetchPrices]);

  return { prices: fetchedPrices, status, lastUpdated, refresh: fetchPrices };
}

const FEED_KIND: Record<string, BadgeKind> = { live: 'live', stale: 'stale', error: 'error', loading: 'loading' };

export function StockPortfolio() {
  const { holdings } = useEquitiesData();
  const [currentPrices, setCurrentPrices] = useState<Record<string, string>>({});

  const activeHoldings = useMemo(() => holdings.filter(h => h.total_lot > 0), [holdings]);
  const { prices: fetchedPrices, status, lastUpdated, refresh } = useSahamPrices(activeHoldings);

  // Resolve a holding's current price: a non-empty manual override wins, else the
  // live feed. Returns NaN when neither is available (unpriced).
  const priceOf = useCallback((h: StockHolding): number => {
    const manual = currentPrices[h.emiten];
    const hasOverride = manual !== undefined && manual !== '';
    return hasOverride ? parseFloat(manual) : (fetchedPrices[h.emiten]?.price || NaN);
  }, [currentPrices, fetchedPrices]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalCurrentValue = 0;
    let allPriced = true;

    activeHoldings.forEach(h => {
      totalCost += h.total_cost_basis;
      const cp = priceOf(h);
      if (!isNaN(cp) && cp > 0) {
        totalCurrentValue += h.total_lot * 100 * cp;
      } else {
        allPriced = false;
      }
    });

    const priced = allPriced && activeHoldings.length > 0;
    return {
      totalCost,
      totalCurrentValue: priced ? totalCurrentValue : null,
      totalPnl: priced ? totalCurrentValue - totalCost : null,
    };
  }, [activeHoldings, priceOf]);

  const feedSecs = lastUpdated != null ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) : null;

  const columns: Column<StockHolding>[] = [
    { key: 'emiten', header: 'Emiten', width: 'minmax(80px,1fr)', cell: h => <span className="font-adm-ui text-adm-ink-hi">{h.emiten}</span> },
    { key: 'lot', header: 'Lot', numeric: true, width: '70px', sortValue: h => h.total_lot, cell: h => String(h.total_lot) },
    { key: 'shares', header: 'Shares', numeric: true, width: '90px', sortValue: h => h.total_lot * 100, cell: h => (h.total_lot * 100).toLocaleString('en-US') },
    { key: 'avg', header: 'Avg Price', numeric: true, width: '110px', sortValue: h => h.average_price, cell: h => fmtIdr(h.average_price) },
    { key: 'cost', header: 'Cost Basis', numeric: true, width: '130px', sortValue: h => h.total_cost_basis, cell: h => fmtIdr(h.total_cost_basis) },
    {
      key: 'price', header: 'Current Price', width: '190px', align: 'right', sortValue: h => priceOf(h),
      cell: h => {
        const fetched = fetchedPrices[h.emiten];
        const manual = currentPrices[h.emiten];
        const hasOverride = manual !== undefined && manual !== '';
        return (
          <div className="flex flex-col items-end gap-1 py-1">
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="1"
                placeholder={fetched?.price ? String(fetched.price) : 'price'}
                value={manual || ''}
                onChange={e => setCurrentPrices(prev => ({ ...prev, [h.emiten]: e.target.value }))}
                className="w-24 rounded-adm-sm border border-adm-line bg-adm-bg0 px-2 py-1 text-right font-adm-data text-adm-xs text-adm-ink-hi outline-none focus:border-adm-line2"
              />
              {hasOverride ? (
                <StatusBadge kind="neutral" label="MANUAL" />
              ) : fetched ? (
                <StatusBadge kind="live" />
              ) : null}
            </div>
            {!hasOverride && fetched?.changePercent != null && (
              <span className={cn('font-adm-data text-adm-micro', fetched.changePercent >= 0 ? 'text-adm-up' : 'text-adm-down')}>
                {fmtSignedPct(fetched.changePercent)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'value', header: 'Current Value', numeric: true, width: '140px',
      sortValue: h => { const cp = priceOf(h); return !isNaN(cp) && cp > 0 ? h.total_lot * 100 * cp : null; },
      cell: h => { const cp = priceOf(h); return !isNaN(cp) && cp > 0 ? fmtIdr(h.total_lot * 100 * cp) : <span className="text-adm-ink-dim">—</span>; },
    },
    {
      key: 'pnl', header: 'Floating P&L', numeric: true, width: '160px',
      sortValue: h => { const cp = priceOf(h); return !isNaN(cp) && cp > 0 ? h.total_lot * 100 * cp - h.total_cost_basis : null; },
      cell: h => {
        const cp = priceOf(h);
        if (isNaN(cp) || cp <= 0) return <span className="text-adm-ink-dim">—</span>;
        const value = h.total_lot * 100 * cp;
        const pnl = value - h.total_cost_basis;
        const pct = h.total_cost_basis > 0 ? (pnl / h.total_cost_basis) * 100 : null;
        return (
          <span className={pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>
            {fmtSignedIdr(pnl)}
            {pct != null && <span className="ml-1 text-adm-ink-dim">({fmtSignedPct(pct)})</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        desk="saham"
        title="Active Portfolio"
        sub="derived from transactions — delete transactions in History to close a position"
        right={
          <div className="flex items-center gap-2">
            {activeHoldings.length > 0 && <StatusBadge kind="open" label={`${activeHoldings.length} HELD`} />}
            <StatusBadge
              kind={FEED_KIND[status] ?? 'loading'}
              detail={status === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined}
              title="Market-proxy feed"
            />
            <button
              onClick={refresh}
              title="Refresh prices"
              aria-label="Refresh prices"
              className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', status === 'loading' && 'animate-spin')} />
            </button>
          </div>
        }
      />

      <MetricStrip
        items={[
          { label: 'Cost basis', value: totals.totalCost, format: 'idr', sub: 'total invested' },
          { label: 'Current value', value: totals.totalCurrentValue != null ? totals.totalCurrentValue : '—', format: totals.totalCurrentValue != null ? 'idr' : 'raw', emphasis: true, sub: totals.totalCurrentValue != null ? 'live valuation' : 'enter all prices' },
          { label: 'Floating P&L', value: totals.totalPnl != null ? totals.totalPnl : '—', format: totals.totalPnl != null ? 'signedIdr' : 'raw', sub: 'value − cost' },
        ]}
      />

      <DataTable
        columns={columns}
        rows={activeHoldings}
        rowKey={h => h.emiten}
        defaultSort={{ key: 'cost', dir: 'desc' }}
        minWidth={960}
        empty="No active holdings. Buy some stocks to get started."
      />
    </div>
  );
}
