import { useState, useMemo } from 'react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { cn } from '../../lib/utils';
import { Briefcase } from 'lucide-react';

export function StockPortfolio() {
  const { holdings } = useEquitiesData();
  const [currentPrices, setCurrentPrices] = useState<Record<string, string>>({});

  const activeHoldings = useMemo(() => holdings.filter(h => h.total_lot > 0), [holdings]);

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalCurrentValue = 0;
    let allPriced = true;

    activeHoldings.forEach(h => {
      totalCost += h.total_cost_basis;
      const cp = parseFloat(currentPrices[h.emiten] || '');
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
  }, [activeHoldings, currentPrices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portofolio Aktif</h2>
          <p className="text-slate-400 text-sm mt-1">Current stock holdings with {activeHoldings.length} active position{activeHoldings.length !== 1 ? 's' : ''}.</p>
          <p className="text-slate-500 text-xs mt-1">Holdings are derived from your transactions — to remove a position, delete its transactions in History.</p>
        </div>
        <Briefcase className="w-6 h-6 text-amber-500" />
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
              const cp = parseFloat(currentPrices[h.emiten] || '');
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
                    <input
                      type="number"
                      step="1"
                      placeholder="Enter price"
                      value={currentPrices[h.emiten] || ''}
                      onChange={(e) => setCurrentPrices(prev => ({ ...prev, [h.emiten]: e.target.value }))}
                      className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-amber-500"
                    />
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
