import { useState, useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Check, X, DollarSign, Trash2, RefreshCw } from 'lucide-react';
import { useForexPrices } from '../contexts/ForexPriceProvider';
import { forexUnrealized, isForexLiveSymbol } from '../lib/forexLivePnl';
import { PriceStatusBadge } from '../components/PriceStatusBadge';
import { useAuth } from '../contexts/AuthProvider';
import { normalizeCashFlowTipe } from '../lib/balanceCalc';

/**
 * Recalculates saldo_akun, persen_profit_loss for ALL closed trades chronologically,
 * factoring in cash flow events. Call this after any PnL update or trade closure.
 * 
 * @param overridePnl — Optional: { tradeId, pnlValue } to override net_pnl for a specific trade
 *                      before recalculating (used when closing a trade with a new PnL value).
 */
async function recalculateBalances(overridePnl?: { tradeId: string; pnlValue: number }) {
  const { data: allTrades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .order('tanggal', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: cashFlows, error: cashFlowsError } = await supabase
    .from('cash_flows')
    .select('*')
    .eq('desk', 'Forex')
    .order('tanggal', { ascending: true });

  // maybeSingle: a missing settings row (fresh migrated DB) must not hard-fail
  // the whole close/delete — we fall back to modal_awal = 0.
  const { data: settings, error: settingsError } = await supabase
    .from('account_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  const readError = tradesError || cashFlowsError || settingsError;
  if (readError) {
    throw new Error(`Could not load data to recalculate account balances. Balances were not updated — refresh the Journal and try again. (${readError.message})`);
  }
  if (!allTrades) return;

  let currentBalance: number = Number(settings?.modal_awal ?? 0);

  // Merge trades and cash flows into a single chronological event stream
  type Event = { type: 'trade'; date: number; createdAt: string; data: typeof allTrades[0] }
             | { type: 'cashflow'; date: number; createdAt: string; data: NonNullable<typeof cashFlows>[0] };

  const events: Event[] = [];
  allTrades.forEach(t => events.push({
    type: 'trade',
    date: new Date(t.tanggal).getTime(),
    createdAt: t.created_at,
    data: t,
  }));
  cashFlows?.forEach(cf => events.push({
    type: 'cashflow',
    date: new Date(cf.tanggal).getTime(),
    createdAt: cf.created_at,
    data: cf,
  }));

  // Sort by date, then by created_at for same-day events
  events.sort((a, b) => a.date - b.date || a.createdAt.localeCompare(b.createdAt));

  const updates: { id: string; net_pnl: number; saldo_akun: number; persen_profit_loss: number; status: string }[] = [];

  for (const ev of events) {
    if (ev.type === 'cashflow') {
      const cf = ev.data;
      const tipe = normalizeCashFlowTipe(cf);
      if (tipe === 'Deposit' || tipe === 'Transfer Masuk') {
        currentBalance += Number(cf.jumlah);
      } else if (tipe === 'Withdraw' || tipe === 'Transfer Keluar') {
        currentBalance -= Number(cf.jumlah);
      }
    } else if (ev.type === 'trade') {
      const t = ev.data;

      // Determine PnL: use override if this is the trade being closed/edited, otherwise use stored
      let pnl: number | null = t.net_pnl;
      let newStatus = t.status;
      if (overridePnl && t.id === overridePnl.tradeId) {
        pnl = overridePnl.pnlValue;
        newStatus = 'Closed';
      }

      // Only closed trades with a PnL affect the running balance
      if (newStatus === 'Closed' && pnl !== null && pnl !== undefined) {
        const prevBalance = currentBalance;
        currentBalance += Number(pnl);
        const pct = prevBalance !== 0 ? (Number(pnl) / prevBalance) * 100 : 0;

        updates.push({
          id: t.id,
          net_pnl: Number(pnl),
          saldo_akun: currentBalance,
          persen_profit_loss: pct,
          status: 'Closed',
        });
      }
    }
  }

  // Batch update all affected trades. Stop on the first failure: this function re-derives
  // every closed trade's balance from scratch, so a partial run is fully fixed by re-running.
  let done = 0;
  for (const update of updates) {
    const { error: updateError } = await supabase.from('trades').update({
      net_pnl: update.net_pnl,
      saldo_akun: update.saldo_akun,
      persen_profit_loss: update.persen_profit_loss,
      status: update.status,
    }).eq('id', update.id);
    if (updateError) {
      throw new Error(`Account balance recalculation failed after updating ${done} of ${updates.length} trade(s) (failed on trade ${update.id}). Balances are partially updated — refresh the Journal to recompute, or retry. (${updateError.message})`);
    }
    done++;
  }
}

export function TradeHistory() {
  const { trades, loading, error: fetchError, refetch } = usePortfolioData();
  const { prices, status, lastUpdated, refresh } = useForexPrices();
  const { isAdmin } = useAuth();
  const [filterInstrument, setFilterInstrument] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'Open' | 'Closed'>('');
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closePnl, setClosePnl] = useState<string>('');
  const [closeExit, setCloseExit] = useState<string>('');
  const [closeDate, setCloseDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const resetClose = () => { setClosingTradeId(null); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); };

  const instruments = useMemo(() => {
    const insts = new Set(trades.map(t => t.instrumen));
    return Array.from(insts);
  }, [trades]);

  const filteredTrades = useMemo(() => {
    let result = trades;
    if (filterInstrument) {
      result = result.filter(t => t.instrumen === filterInstrument);
    }
    if (filterStatus) {
      result = result.filter(t => t.status === filterStatus);
    }
    // Most recent first
    return result.slice().reverse();
  }, [trades, filterInstrument, filterStatus]);

  const handleCloseTrade = async (tradeId: string) => {
    const pnlValue = parseFloat(closePnl);
    if (isNaN(pnlValue)) {
      alert("Please enter a valid PnL number");
      return;
    }
    // Exit price optional; if given it must be valid. Close date defaults to today.
    const exitVal = closeExit.trim() === '' ? null : parseFloat(closeExit);
    if (closeExit.trim() !== '' && (exitVal == null || isNaN(exitVal) || exitVal <= 0)) {
      alert("Exit price must be a positive number (or left blank)");
      return;
    }
    const closeDateVal = closeDate || new Date().toISOString().split('T')[0];

    setIsProcessing(true);
    try {
      // 1) Record exit metadata (harga_exit + tanggal_tutup). net_pnl/status/saldo
      //    are set by the replay below — keep these as separate, informational fields.
      const { error: metaErr } = await supabase.from('trades')
        .update({ harga_exit: exitVal, tanggal_tutup: closeDateVal })
        .eq('id', tradeId);
      if (metaErr) throw new Error(`Could not save the exit details; the trade was not closed. Please try again. (${metaErr.message})`);

      // 2) Replay sets net_pnl, status='Closed', saldo_akun.
      await recalculateBalances({ tradeId, pnlValue });
      resetClose();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteTrade = async (tradeId: string) => {
    if (!window.confirm('Delete this trade? This cannot be undone. Account balances will be recalculated.')) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('trades').delete().eq('id', tradeId);
      if (error) throw error;
      // Replay re-derives saldo_akun for the remaining closed trades from scratch.
      await recalculateBalances();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Re-derives saldo_akun for every closed trade from scratch (Forex cash flows + P&L).
  // Idempotent — safe to run anytime; used to heal balances after data/logic fixes.
  const handleRecalculate = async () => {
    setIsRecalculating(true);
    try {
      await recalculateBalances();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsRecalculating(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-400">Loading journal...</div>;

  return (
    <div className="space-y-6">
      {fetchError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-400 text-sm">
          Failed to load journal data: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-rose-300">Retry</button>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Trade Journal</h2>
        
        <div className="flex items-center gap-3">
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
          {isAdmin && (
            <button
              onClick={handleRecalculate}
              disabled={isRecalculating}
              title="Re-derive every closed trade's account balance from cash flows + P&L"
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-4 h-4', isRecalculating && 'animate-spin')} />
              {isRecalculating ? 'Recalculating...' : 'Recalculate Balances'}
            </button>
          )}

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | 'Open' | 'Closed')}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="">All Status</option>
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>

          <select 
            value={filterInstrument}
            onChange={(e) => setFilterInstrument(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="">All Instruments</option>
            {instruments.map(inst => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Instrument</th>
              <th className="px-4 py-3">Pos</th>
              <th className="px-4 py-3">Entry</th>
              <th className="px-4 py-3">Exit</th>
              <th className="px-4 py-3">SL</th>
              <th className="px-4 py-3 text-right">Mark</th>
              <th className="px-4 py-3">Setup / Psych</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3 text-right">Unrealized P&L</th>
              <th className="px-4 py-3 text-right">Net PnL</th>
              <th className="px-4 py-3 text-right">Gain %</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.map((trade) => {
              // Live price + unrealized only for open positions on instruments with a feed (today: XAUUSD).
              const markPrice = trade.status === 'Open' && isForexLiveSymbol(trade.instrumen)
                ? prices.get(trade.instrumen.toUpperCase())
                : undefined;
              const uPnl = forexUnrealized(trade, markPrice);
              const showLive = trade.status === 'Open' && isForexLiveSymbol(trade.instrumen) && markPrice != null;
              return (
              <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                <td className="px-4 py-3 text-slate-300">{format(parseISO(trade.tanggal), 'dd MMM yyyy')}</td>
                <td className="px-4 py-3 font-medium text-slate-200">{trade.instrumen}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    trade.posisi === 'Buy' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                  )}>
                    {trade.posisi}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{trade.harga_entry}</td>
                <td className="px-4 py-3 text-slate-300">{trade.harga_exit != null ? trade.harga_exit : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-slate-400">{trade.sl || '-'}</td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {showLive ? `$${markPrice!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-blue-400">{trade.setup_tag?.name || '-'}</span>
                    <span className="text-xs text-purple-400">{trade.psychology_tag?.name || '-'}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    trade.status === 'Open'
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                      : "bg-slate-700/30 text-slate-300 border border-slate-600/20"
                  )}>
                    {trade.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {trade.tanggal_tutup ? format(parseISO(trade.tanggal_tutup), 'dd MMM yyyy') : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {showLive ? (
                    <span className={cn('font-medium', uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                      {uPnl >= 0 ? '+' : ''}${uPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {closingTradeId === trade.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <input
                        type="number"
                        value={closePnl}
                        onChange={(e) => setClosePnl(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Net PnL"
                        autoFocus
                      />
                      <input
                        type="number"
                        value={closeExit}
                        onChange={(e) => setCloseExit(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Exit price (opt)"
                      />
                      <input
                        type="date"
                        value={closeDate}
                        onChange={(e) => setCloseDate(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        title="Close date"
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleCloseTrade(trade.id)}
                          disabled={isProcessing}
                          className="p-1 bg-emerald-600 rounded text-white hover:bg-emerald-500 disabled:opacity-50"
                          title="Confirm"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={resetClose}
                          className="p-1 bg-slate-700 rounded text-white hover:bg-slate-600"
                          title="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className={cn(
                      "font-medium",
                      trade.net_pnl != null && trade.net_pnl > 0 ? "text-emerald-400" :
                      trade.net_pnl != null && trade.net_pnl < 0 ? "text-rose-400" :
                      trade.net_pnl != null && trade.net_pnl === 0 ? "text-slate-400" :
                      "text-slate-500"
                    )}>
                      {trade.net_pnl != null ? `$${trade.net_pnl.toLocaleString()}` : '-'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-400">
                  {trade.persen_profit_loss != null ? `${trade.persen_profit_loss.toFixed(2)}%` : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && closingTradeId !== trade.id && (
                    <div className="flex items-center justify-end gap-2">
                      {trade.status === 'Open' && (
                        <button
                          onClick={() => { setClosingTradeId(trade.id); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); }}
                          className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors"
                          title="Close Trade & Enter PnL"
                        >
                          <DollarSign className="w-3 h-3" />
                          Close
                        </button>
                      )}
                      {trade.status === 'Closed' && (
                        <button
                          onClick={() => { setClosingTradeId(trade.id); setClosePnl(trade.net_pnl?.toString() || ''); setCloseExit(trade.harga_exit?.toString() || ''); setCloseDate(trade.tanggal_tutup || new Date().toISOString().split('T')[0]); }}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                          title="Edit PnL / exit"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteTrade(trade.id)}
                        disabled={isProcessing}
                        className="text-slate-400 hover:text-rose-400 disabled:opacity-50"
                        title="Delete trade"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
              );
            })}
            {filteredTrades.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-8 text-center text-slate-500">No trades found in the journal.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
