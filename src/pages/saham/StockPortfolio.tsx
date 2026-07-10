import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { cn } from '../../lib/utils';
import { Briefcase } from 'lucide-react';
import { PriceStatusBadge, type PriceStatus } from '../../components/PriceStatusBadge';
import type { StockHolding } from '../../types';

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

export function StockPortfolio() {
  const { holdings } = useEquitiesData();
  const [currentPrices, setCurrentPrices] = useState<Record<string, string>>({});

  const activeHoldings = useMemo(() => holdings.filter(h => h.total_lot > 0), [holdings]);
  const { prices: fetchedPrices, status, lastUpdated, refresh } = useSahamPrices(activeHoldings);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalCurrentValue = 0;
    let allPriced = true;

    activeHoldings.forEach(h => {
      totalCost += h.total_cost_basis;
      const manual = currentPrices[h.emiten];
      const hasOverride = manual !== undefined && manual !== '';
      const cp = hasOverride ? parseFloat(manual) : (fetchedPrices[h.emiten]?.price || NaN);
      
      if (!isNaN(cp) && cp > 0) {
        totalCurrentValue += h.total_lot * 100 * cp;
      } else {
        allPriced = false;
      }
    });

    return {
      totalCost,
      totalCurrentValue: allPriced && activeHoldings.length > 0 ? totalCurrentValue : null,
      totalPnl: allPriced && activeHoldings.length > 0 ? totalCurrentValue - totalCost : null,
    };
  }, [activeHoldings, currentPrices, fetchedPrices]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portofolio Aktif</h2>
          <p className="text-slate-400 text-sm mt-1">Current stock holdings with {activeHoldings.length} active position{activeHoldings.length !== 1 ? 's' : ''}.</p>
          <p className="text-slate-500 text-xs mt-1">Holdings are derived from your transactions — to remove a position, delete its transactions in History.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
          <Briefcase className="w-6 h-6 text-amber-500" />
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Emiten</th>
              <th className="px-4 py-3">Lot</th>
              <th className="px-4 py-3">Shares</th>
              <th className="px-4 py-3">Avg Price</th>
              <th className="px-4 py-3">Cost Basis</th>
              <th className="px-4 py-3">Current Price</th>
              <th className="px-4 py-3">Current Value</th>
              <th className="px-4 py-3 text-right">Floating P&L</th>
            </tr>
          </thead>
          <tbody>
            {activeHoldings.map(h => {
              const fetched = fetchedPrices[h.emiten];
              const manual = currentPrices[h.emiten];
              const hasOverride = manual !== undefined && manual !== '';
              const cp = hasOverride ? parseFloat(manual) : (fetched?.price || NaN);
              
              const hasCp = !isNaN(cp) && cp > 0;
              const currentValue = hasCp ? h.total_lot * 100 * cp : null;
              const floatingPnl = currentValue !== null ? currentValue - h.total_cost_basis : null;
              const pnlPct = floatingPnl !== null && h.total_cost_basis > 0 ? (floatingPnl / h.total_cost_basis) * 100 : null;

              return (
                <tr key={h.emiten} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                  <td className="px-4 py-3 font-medium text-slate-200">{h.emiten}</td>
                  <td className="px-4 py-3 text-slate-300">{h.total_lot}</td>
                  <td className="px-4 py-3 text-slate-400">{(h.total_lot * 100).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-300">Rp{h.average_price.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-300">Rp{h.total_cost_basis.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="1"
                          placeholder={fetched?.price ? String(fetched.price) : "Enter price"}
                          value={currentPrices[h.emiten] || ''}
                          onChange={(e) => setCurrentPrices(prev => ({ ...prev, [h.emiten]: e.target.value }))}
                          className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        {hasOverride ? (
                          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider bg-slate-800 px-1.5 py-0.5 rounded">Manual</span>
                        ) : fetched ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500 uppercase tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Live
                          </span>
                        ) : null}
                      </div>
                      {!hasOverride && fetched?.changePercent != null && (
                        <span className={cn("text-[11px] font-medium ml-1", fetched.changePercent >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {fetched.changePercent >= 0 ? '▲' : '▼'} {Math.abs(fetched.changePercent).toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {currentValue !== null ? `Rp${currentValue.toLocaleString()}` : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {floatingPnl !== null ? (
                      <div>
                        <span className={cn('font-medium', floatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {floatingPnl >= 0 ? '+' : ''}Rp{floatingPnl.toLocaleString()}
                        </span>
                        {pnlPct !== null && (
                          <span className={cn('ml-1 text-xs', floatingPnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {activeHoldings.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No active holdings. Buy some stocks to get started.</td></tr>
            )}
          </tbody>
          {activeHoldings.length > 0 && (
            <tfoot className="border-t border-slate-700 bg-slate-950/30">
              <tr>
                <td colSpan={4} className="px-4 py-3 font-medium text-slate-300">Totals</td>
                <td className="px-4 py-3 font-medium text-slate-200">Rp{totals.totalCost.toLocaleString()}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{totals.totalCurrentValue !== null ? '' : 'Enter all prices'}</td>
                <td className="px-4 py-3 font-medium text-slate-200">{totals.totalCurrentValue !== null ? `Rp${totals.totalCurrentValue.toLocaleString()}` : '—'}</td>
                <td className="px-4 py-3 text-right font-medium">
                  {totals.totalPnl !== null ? (
                    <span className={cn(totals.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                      {totals.totalPnl >= 0 ? '+' : ''}Rp{totals.totalPnl.toLocaleString()}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
