import { useState, useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { Check, X, DollarSign, Trash2, Pencil } from 'lucide-react';
import { useForexPrices } from '../contexts/ForexPriceProvider';
import { getContractSize } from '../types';
import { forexUnrealized, isForexLiveSymbol } from '../lib/forexLivePnl';
import { PriceStatusBadge } from '../components/PriceStatusBadge';
import { useAuth } from '../contexts/AuthProvider';
import { recalculateBalances } from '../lib/forexBalances';
import { formatTradeId, formatUsd, formatPct, formatRr, formatNum, formatSession } from '../lib/tradeFormat';
import { HScrollTable } from '../components/HScrollTable';
import type { Trade, TradePosition } from '../types';

export function OpenPositions() {
  const { trades, setupTags, psychologyTags, instrumentSpecs, loading, error: fetchError, refetch } = usePortfolioData();
  const { prices, status, lastUpdated, refresh } = useForexPrices();
  const { isAdmin } = useAuth();

  const [filterInstrument, setFilterInstrument] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Close form state (per-row)
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closePnl, setClosePnl] = useState('');
  const [closeExit, setCloseExit] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split('T')[0]);

  // Edit drawer state
  const [editTrade, setEditTrade] = useState<Trade | null>(null);
  const [editForm, setEditForm] = useState({ instrumen: '', posisi: 'Buy' as TradePosition, harga_entry: '', sl: '', setup: '', psikologi: '' });

  const resetClose = () => { setClosingTradeId(null); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); };

  const openTrades = useMemo(() => trades.filter(t => t.status === 'Open'), [trades]);

  const instruments = useMemo(() => Array.from(new Set(openTrades.map(t => t.instrumen))), [openTrades]);

  const filteredTrades = useMemo(() => {
    let result = openTrades;
    if (filterInstrument) result = result.filter(t => t.instrumen === filterInstrument);
    return result.slice().reverse();
  }, [openTrades, filterInstrument]);

  const openEditDrawer = (trade: Trade) => {
    setEditTrade(trade);
    setEditForm({
      instrumen: trade.instrumen,
      posisi: trade.posisi,
      harga_entry: trade.harga_entry?.toString() ?? '',
      sl: trade.sl?.toString() ?? '',
      setup: trade.setup ?? '',
      psikologi: trade.psikologi ?? '',
    });
  };

  const handleSaveEdit = async () => {
    if (!editTrade) return;
    if (!editForm.instrumen.trim()) { alert('Instrument is required'); return; }
    const entryVal = parseFloat(editForm.harga_entry);
    if (isNaN(entryVal) || entryVal <= 0) { alert('Entry price must be a positive number'); return; }
    const slVal = editForm.sl.trim() === '' ? null : parseFloat(editForm.sl);
    if (editForm.sl.trim() !== '' && (slVal == null || isNaN(slVal) || slVal <= 0)) { alert('SL must be a positive number (or blank)'); return; }

    // Re-snapshot point_value if the instrument changed (the DB trigger only fires on INSERT),
    // so the GENERATED risk_usd / risk_pct stay consistent with the new instrument.
    const instrKey = editForm.instrumen.trim().toUpperCase();
    const spec = instrumentSpecs.find(s => s.instrument.toUpperCase() === instrKey);
    const point_value = spec ? Number(spec.point_value) : getContractSize(editForm.instrumen.trim());

    setIsProcessing(true);
    try {
      const { error } = await supabase.from('trades').update({
        instrumen: editForm.instrumen.trim(),
        posisi: editForm.posisi,
        harga_entry: entryVal,
        sl: slVal,
        setup: editForm.setup || null,
        psikologi: editForm.psikologi || null,
        point_value,
      }).eq('id', editTrade.id);
      if (error) throw error;
      setEditTrade(null);
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClosePosition = async (tradeId: string) => {
    const pnlValue = parseFloat(closePnl);
    if (isNaN(pnlValue)) { alert('Please enter a valid PnL number'); return; }
    const exitVal = closeExit.trim() === '' ? null : parseFloat(closeExit);
    if (closeExit.trim() !== '' && (exitVal == null || isNaN(exitVal) || exitVal <= 0)) {
      alert('Exit price must be a positive number (or left blank)'); return;
    }
    const closeDateVal = closeDate || new Date().toISOString().split('T')[0];

    setIsProcessing(true);
    try {
      // Record exit metadata; the replay sets net_pnl, status='Closed', saldo_akun.
      const { error: metaErr } = await supabase.from('trades')
        .update({ harga_exit: exitVal, tanggal_tutup: closeDateVal })
        .eq('id', tradeId);
      if (metaErr) throw new Error(`Could not save the exit details; the position was not closed. (${metaErr.message})`);
      await recalculateBalances({ tradeId, pnlValue });
      resetClose();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (tradeId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this position?')) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('trades').delete().eq('id', tradeId);
      if (error) throw error;
      await recalculateBalances();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (loading) return <div className="p-8 text-slate-400">Loading open positions...</div>;

  return (
    <div className="space-y-6">
      {fetchError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-400 text-sm">
          Failed to load positions: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-rose-300">Retry</button>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Open Positions</h2>
          <p className="text-sm text-slate-500">Live unrealized P&amp;L — manage, close, or delete</p>
        </div>

        <div className="flex items-center gap-3">
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
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
              <th className="px-4 py-3">SL</th>
              <th className="px-4 py-3">TP</th>
              <th className="px-4 py-3 text-right">Mark</th>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Setup / Psych</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Pt Val</th>
              <th className="px-4 py-3 text-right">Risk $</th>
              <th className="px-4 py-3 text-right">Risk %</th>
              <th className="px-4 py-3 text-right">R:R Plan</th>
              <th className="px-4 py-3 text-right">Unrealized P&amp;L</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.map((trade) => {
              const markPrice = isForexLiveSymbol(trade.instrumen)
                ? prices.get(trade.instrumen.toUpperCase())
                : undefined;
              const uPnl = forexUnrealized(trade, markPrice);
              const showLive = isForexLiveSymbol(trade.instrumen) && markPrice != null;
              return (
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
                  <td className={cn("px-4 py-3", trade.sl ? "text-rose-400" : "text-slate-400")}>{trade.sl || '-'}</td>
                  <td className={cn("px-4 py-3", trade.tp ? "text-emerald-400" : "text-slate-400")}>{trade.tp || '-'}</td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {showLive ? `$${markPrice!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-300 whitespace-nowrap text-xs">{formatSession(trade.session)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-blue-400">{trade.setup_tag?.name || '-'}</span>
                      <span className="text-xs text-purple-400">{trade.psychology_tag?.name || '-'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Open
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatNum(trade.point_value)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-200 tabular-nums">{formatUsd(trade.risk_usd)}</td>
                  <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatPct(trade.risk_pct)}</td>
                  <td className="px-4 py-3 text-right text-slate-300 tabular-nums">{formatRr(trade.rr_planned)}</td>
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
                            onClick={() => handleClosePosition(trade.id)}
                            disabled={isProcessing}
                            className="p-1 bg-emerald-600 rounded text-white hover:bg-emerald-500 disabled:opacity-50"
                            title="Confirm close"
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
                    ) : showLive ? (
                      <span className={cn('font-medium', uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {uPnl >= 0 ? '+' : ''}${uPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    ) : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && closingTradeId !== trade.id && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditDrawer(trade)}
                          className="flex items-center gap-1 text-xs text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded transition-colors"
                          title="Edit position"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => { setClosingTradeId(trade.id); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); }}
                          className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors"
                          title="Close position & enter PnL"
                        >
                          <DollarSign className="w-3 h-3" />
                          Close
                        </button>
                        <button
                          onClick={() => handleDelete(trade.id)}
                          disabled={isProcessing}
                          className="text-slate-400 hover:text-rose-400 disabled:opacity-50"
                          title="Delete position"
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
                <td colSpan={18} className="px-4 py-8 text-center text-slate-500">No open positions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </HScrollTable>

      {/* Edit drawer */}
      {editTrade && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => !isProcessing && setEditTrade(null)}>
          <div
            className="w-full max-w-md h-full bg-slate-900 border-l border-slate-800 p-6 overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold">Edit Position</h3>
              <button onClick={() => setEditTrade(null)} className="text-slate-400 hover:text-slate-100" title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Instrument</label>
                <input
                  type="text"
                  value={editForm.instrumen}
                  onChange={(e) => setEditForm(f => ({ ...f, instrumen: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Position</label>
                <div className="flex gap-2">
                  {(['Buy', 'Sell'] as TradePosition[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEditForm(f => ({ ...f, posisi: p }))}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors",
                        editForm.posisi === p
                          ? (p === 'Buy' ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" : "bg-rose-500/15 text-rose-400 border-rose-500/40")
                          : "bg-slate-950 text-slate-400 border-slate-700 hover:text-slate-200"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Entry Price</label>
                  <input
                    type="number"
                    value={editForm.harga_entry}
                    onChange={(e) => setEditForm(f => ({ ...f, harga_entry: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Stop Loss</label>
                  <input
                    type="number"
                    value={editForm.sl}
                    onChange={(e) => setEditForm(f => ({ ...f, sl: e.target.value }))}
                    placeholder="Optional"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Setup</label>
                <select
                  value={editForm.setup}
                  onChange={(e) => setEditForm(f => ({ ...f, setup: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">— None —</option>
                  {setupTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Psychology</label>
                <select
                  value={editForm.psikologi}
                  onChange={(e) => setEditForm(f => ({ ...f, psikologi: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="">— None —</option>
                  {psychologyTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={isProcessing}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {isProcessing ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setEditTrade(null)}
                  disabled={isProcessing}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
