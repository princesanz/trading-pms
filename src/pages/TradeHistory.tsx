import { useState, useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Check, X, Trash2, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthProvider';
import { recalculateBalances } from '../lib/forexBalances';
import { HScrollTable } from '../components/HScrollTable';
import { formatTradeId, formatUsd, formatPct, formatRr, formatNum, formatSession } from '../lib/tradeFormat';
import { sortClosedDesc } from '../lib/sortTrades';

export function TradeHistory() {
  const { trades, loading, error: fetchError, refetch } = usePortfolioData();
  const { isAdmin } = useAuth();
  const [filterInstrument, setFilterInstrument] = useState('');
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null);
  const [editPnl, setEditPnl] = useState<string>('');
  const [editExit, setEditExit] = useState<string>('');
  const [editDate, setEditDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [page, setPage] = useState(1);

  const resetEdit = () => { setEditingTradeId(null); setEditPnl(''); setEditExit(''); setEditDate(new Date().toISOString().split('T')[0]); };

  // Closed history only — open positions live in the "Open Positions" view.
  const closedTrades = useMemo(() => trades.filter(t => t.status === 'Closed'), [trades]);

  const instruments = useMemo(() => {
    const insts = new Set(closedTrades.map(t => t.instrumen));
    return Array.from(insts);
  }, [closedTrades]);

  const filteredTrades = useMemo(() => {
    let result = closedTrades;
    if (filterInstrument) {
      result = result.filter(t => t.instrumen === filterInstrument);
    }
    // Shared comparator: close date DESC, tie-broken by trade_number DESC (see sortTrades.ts),
    // so same-day trades order identically here and on the public Track Record.
    return sortClosedDesc(result, t => ({
      closeDate: t.tanggal_tutup || t.tanggal,
      tradeNumber: t.trade_number,
      fallbackTs: t.created_at,
    }));
  }, [closedTrades, filterInstrument]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedTrades = useMemo(
    () => filteredTrades.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredTrades, safePage]
  );

  const handleEditTrade = async (tradeId: string) => {
    const pnlValue = parseFloat(editPnl);
    if (isNaN(pnlValue)) {
      alert("Please enter a valid PnL number");
      return;
    }
    const exitVal = editExit.trim() === '' ? null : parseFloat(editExit);
    if (editExit.trim() !== '' && (exitVal == null || isNaN(exitVal) || exitVal <= 0)) {
      alert("Exit price must be a positive number (or left blank)");
      return;
    }
    const closeDateVal = editDate || new Date().toISOString().split('T')[0];

    setIsProcessing(true);
    try {
      const { error: metaErr } = await supabase.from('trades')
        .update({ harga_exit: exitVal, tanggal_tutup: closeDateVal })
        .eq('id', tradeId);
      if (metaErr) throw new Error(`Could not save the exit details. Please try again. (${metaErr.message})`);

      // Replay re-derives net_pnl, status, saldo_akun for the whole closed history.
      await recalculateBalances({ tradeId, pnlValue });
      resetEdit();
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
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Trade Journal</h2>
          <p className="text-sm text-slate-500">Closed trade history — realized P&amp;L</p>
        </div>

        <div className="flex items-center gap-3">
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
            value={filterInstrument}
            onChange={(e) => { setFilterInstrument(e.target.value); setPage(1); }}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
          >
            <option value="">All Instruments</option>
            {instruments.map(inst => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
        </div>
      </div>

      <HScrollTable className="bg-slate-900 border border-slate-800 rounded-xl">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Instrument</th>
              <th className="px-4 py-3 text-right">Lot</th>
              <th className="px-4 py-3">Pos</th>
              <th className="px-4 py-3">Entry</th>
              <th className="px-4 py-3">Exit</th>
              <th className="px-4 py-3">SL</th>
              <th className="px-4 py-3">TP</th>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Setup / Psych</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3 text-right">Pt Val</th>
              <th className="px-4 py-3 text-right">Risk $</th>
              <th className="px-4 py-3 text-right">Risk %</th>
              <th className="px-4 py-3 text-right">R:R Plan</th>
              <th className="px-4 py-3 text-right">R:R Act</th>
              <th className="px-4 py-3 text-right">Net PnL</th>
              <th className="px-4 py-3 text-right">Gain %</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pagedTrades.map((trade) => (
              <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">{formatTradeId(trade.trade_number)}</td>
                <td className="px-4 py-3 text-slate-300">{format(parseISO(trade.tanggal), 'dd MMM yyyy')}</td>
                <td className="px-4 py-3 font-medium text-slate-200">{trade.instrumen}</td>
                <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{trade.lot != null ? trade.lot.toFixed(2) : '-'}</td>
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
                <td className="px-4 py-3 text-slate-400">{trade.tp || '-'}</td>
                <td className="px-4 py-3 text-slate-300 whitespace-nowrap text-xs">{formatSession(trade.session)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-blue-400">{trade.setup_tag?.name || '-'}</span>
                    <span className="text-xs text-purple-400">{trade.psychology_tag?.name || '-'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {trade.tanggal_tutup ? format(parseISO(trade.tanggal_tutup), 'dd MMM yyyy') : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatNum(trade.point_value)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-200 tabular-nums">{formatUsd(trade.risk_usd)}</td>
                <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatPct(trade.risk_pct)}</td>
                <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatRr(trade.rr_planned)}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  <span className={cn(
                    trade.rr_actual == null ? "text-slate-500" : trade.rr_actual >= 0 ? "text-emerald-400" : "text-rose-400"
                  )}>
                    {formatRr(trade.rr_actual)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {editingTradeId === trade.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <input
                        type="number"
                        value={editPnl}
                        onChange={(e) => setEditPnl(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Net PnL"
                        autoFocus
                      />
                      <input
                        type="number"
                        value={editExit}
                        onChange={(e) => setEditExit(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        placeholder="Exit price (opt)"
                      />
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-emerald-500"
                        title="Close date"
                      />
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleEditTrade(trade.id)}
                          disabled={isProcessing}
                          className="p-1 bg-emerald-600 rounded text-white hover:bg-emerald-500 disabled:opacity-50"
                          title="Confirm"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={resetEdit}
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
                  {isAdmin && editingTradeId !== trade.id && (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditingTradeId(trade.id); setEditPnl(trade.net_pnl?.toString() || ''); setEditExit(trade.harga_exit?.toString() || ''); setEditDate(trade.tanggal_tutup || new Date().toISOString().split('T')[0]); }}
                        className="text-slate-500 hover:text-slate-300 text-xs"
                        title="Edit PnL / exit"
                      >
                        Edit
                      </button>
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
            ))}
            {filteredTrades.length === 0 && (
              <tr>
                <td colSpan={20} className="px-4 py-8 text-center text-slate-500">No closed trades in the journal yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </HScrollTable>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs uppercase tracking-wider text-slate-500">
            Page {safePage} of {totalPages}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <PageBtn label="«" title="First page" disabled={safePage === 1} onClick={() => setPage(1)} />
            <PageBtn label="‹" title="Previous page" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))} />
            {pageList(safePage, totalPages).map((p, i) =>
              p === '…' ? (
                <span key={`e${i}`} className="text-xs text-slate-500 px-1.5 select-none">…</span>
              ) : (
                <PageBtn key={p} label={String(p)} active={p === safePage} onClick={() => setPage(p)} />
              )
            )}
            <PageBtn label="›" title="Next page" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} />
            <PageBtn label="»" title="Last page" disabled={safePage === totalPages} onClick={() => setPage(totalPages)} />
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 10;

/** Windowed page-number list with ellipsis gaps, e.g. total=20, current=5 → [1,'…',4,5,6,'…',20]. */
function pageList(current: number, total: number): (number | '…')[] {
  if (total <= 1) return [1];
  const range: number[] = [];
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) range.push(i);
  const pages: (number | '…')[] = [1];
  if (range.length && range[0] > 2) pages.push('…');
  pages.push(...range);
  if (range.length && range[range.length - 1] < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

/** Pagination button — internal dark theme (active = emerald accent, else slate/bordered). */
function PageBtn({
  label, onClick, active = false, disabled = false, title,
}: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      title={title}
      className={cn(
        "min-w-[32px] px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors focus:ring-1 focus:ring-emerald-500 outline-none disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
          : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-slate-100"
      )}
    >
      {label}
    </button>
  );
}
