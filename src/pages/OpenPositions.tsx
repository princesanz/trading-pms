import { useState, useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { RefreshCw, X } from 'lucide-react';
import { useForexPolling, useForexPrice, useForexFeedMeta, refreshForex } from '../state/prices';
import { getContractSize } from '../types';
import { forexUnrealized, isForexLiveSymbol } from '../lib/forexLivePnl';
import { useAuth } from '../contexts/AuthProvider';
import { recalculateBalances } from '../lib/forexBalances';
import { formatTradeId, formatUsd, formatPct, formatRr, formatNum, formatSession } from '../lib/tradeFormat';
import { PageHeader } from '../components/adm/PageHeader';
import { StatusBadge } from '../components/adm/StatusBadge';
import { DataTable, type Column } from '../components/adm/DataTable';
import { fmtSignedUsd, fmtPrice } from '../design/format';
import type { Trade, TradePosition } from '../types';

/* Per-row live cells — each subscribes to ONE symbol in the price store, so a
 * 5s tick re-renders only the mark/uPnL spans of rows with a live feed. Raw
 * number swap, no animation (motion rule). */
function LiveMark({ instrument }: { instrument: string }) {
  const live = isForexLiveSymbol(instrument);
  const price = useForexPrice(live ? instrument.toUpperCase() : '');
  if (!live || price == null) return <span className="text-adm-ink-dim">—</span>;
  return <span className="text-adm-ink-hi">{fmtPrice(price)}</span>;
}

function LiveUPnl({ trade }: { trade: Trade }) {
  const live = isForexLiveSymbol(trade.instrumen);
  const price = useForexPrice(live ? trade.instrumen.toUpperCase() : '');
  if (!live || price == null) return <span className="text-adm-ink-dim">—</span>;
  const uPnl = forexUnrealized(trade, price);
  return <span className={uPnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(uPnl)}</span>;
}

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

export function OpenPositions() {
  useForexPolling();
  const { trades, setupTags, psychologyTags, instrumentSpecs, loading, error: fetchError, refetch } = usePortfolioData();
  const feed = useForexFeedMeta();
  const { isAdmin } = useAuth();

  const [filterInstrument, setFilterInstrument] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Close form state (drawer; same fields + mutation as the old inline form)
  const [closingTrade, setClosingTrade] = useState<Trade | null>(null);
  const [closePnl, setClosePnl] = useState('');
  const [closeExit, setCloseExit] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split('T')[0]);

  // Edit drawer state
  const [editTrade, setEditTrade] = useState<Trade | null>(null);
  const [editForm, setEditForm] = useState({ instrumen: '', posisi: 'Buy' as TradePosition, harga_entry: '', sl: '', setup: '', psikologi: '' });

  const resetClose = () => { setClosingTrade(null); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); };

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

  const columns: Column<Trade>[] = [
    { key: 'id', header: 'ID', width: '84px', sortValue: t => t.trade_number ?? null, cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-dim">{formatTradeId(t.trade_number)}</span> },
    { key: 'tanggal', header: 'Opened', width: '104px', cell: t => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(t.tanggal), 'dd MMM yy')}</span> },
    { key: 'instrumen', header: 'Instrument', width: '100px', cell: t => <span className="font-adm-data text-adm-ink-hi">{t.instrumen}</span> },
    { key: 'lot', header: 'Lot', numeric: true, width: '64px', cell: t => (t.lot != null ? t.lot.toFixed(2) : '—') },
    { key: 'posisi', header: 'Side', width: '76px', cell: t => <StatusBadge kind={t.posisi === 'Buy' ? 'long' : 'short'} label={t.posisi.toUpperCase()} /> },
    { key: 'harga_entry', header: 'Entry', numeric: true, width: '90px', cell: t => fmtPrice(t.harga_entry ?? 0) },
    { key: 'sl', header: 'SL', numeric: true, width: '84px', cell: t => (t.sl ? <span className="text-adm-down">{fmtPrice(t.sl)}</span> : <span className="text-adm-ink-dim">—</span>) },
    { key: 'tp', header: 'TP', numeric: true, width: '84px', cell: t => (t.tp ? <span className="text-adm-up">{fmtPrice(t.tp)}</span> : <span className="text-adm-ink-dim">—</span>) },
    { key: 'mark', header: 'Mark', numeric: true, width: '90px', sortValue: () => null, cell: t => <LiveMark instrument={t.instrumen} /> },
    { key: 'session', header: 'Session', width: '120px', cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-mid">{formatSession(t.session)}</span> },
    { key: 'tags', header: 'Setup · Psych', width: 'minmax(120px,1fr)', cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-mid">{t.setup_tag?.name || '—'} · {t.psychology_tag?.name || '—'}</span> },
    { key: 'point_value', header: 'Pt val', numeric: true, width: '70px', cell: t => formatNum(t.point_value) },
    { key: 'risk_usd', header: 'Risk $', numeric: true, width: '90px', sortValue: t => t.risk_usd ?? null, cell: t => formatUsd(t.risk_usd) },
    { key: 'risk_pct', header: 'Risk %', numeric: true, width: '80px', cell: t => formatPct(t.risk_pct) },
    { key: 'rr_planned', header: 'R:R', numeric: true, width: '70px', cell: t => formatRr(t.rr_planned) },
    { key: 'upnl', header: 'Unrlzd P&L', numeric: true, width: '110px', sortValue: () => null, cell: t => <LiveUPnl trade={t} /> },
    {
      key: 'actions', header: '', width: '150px', align: 'right',
      cell: t => isAdmin ? (
        <span className="flex items-center justify-end gap-1">
          <button onClick={() => openEditDrawer(t)} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2" title="Edit position">Edit</button>
          <button onClick={() => { setClosingTrade(t); setClosePnl(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); }} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-desk-forex hover:bg-adm-bg2" title="Close position & enter PnL">Close</button>
          <button onClick={() => handleDelete(t.id)} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-down hover:bg-adm-bg2 disabled:opacity-40" title="Delete position">Del</button>
        </span>
      ) : null,
    },
  ];

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading open positions…</div>;

  const feedSecs = feed.lastUpdated != null ? Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000)) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="forex"
        title="Open Positions"
        sub="live unrealized P&L · manage, close, delete"
        right={
          <div className="flex items-center gap-2">
            <StatusBadge kind={feed.status} detail={feed.status === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined} title="gold-api feed" />
            <button onClick={refreshForex} title="Refresh prices" aria-label="Refresh prices" className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2">
              <RefreshCw className={cn('h-3.5 w-3.5', feed.status === 'loading' && 'animate-spin')} />
            </button>
            <select
              value={filterInstrument}
              onChange={e => setFilterInstrument(e.target.value)}
              className="rounded-adm-sm border border-adm-line bg-adm-bg1 px-2 py-1 font-adm-data text-adm-xs text-adm-ink-mid focus:border-adm-line2 focus:outline-none"
            >
              <option value="">All instruments</option>
              {instruments.map(inst => <option key={inst} value={inst}>{inst}</option>)}
            </select>
          </div>
        }
      />

      {fetchError && (
        <p className="rounded-adm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
          Failed to load positions: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-adm-ink-hi">Retry</button>
        </p>
      )}

      <DataTable columns={columns} rows={filteredTrades} rowKey={t => t.id} minWidth={1560} empty="No open positions." />

      {/* Close drawer — same fields + mutation path as the old inline form. */}
      {closingTrade && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,12,14,0.85)]" onClick={() => !isProcessing && resetClose()}>
          <div className="h-full w-full max-w-sm overflow-y-auto border-l border-adm-line2 bg-adm-bg1 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Close position</p>
                <h3 className="font-adm-ui text-adm-lg font-medium text-adm-ink-hi">
                  {closingTrade.instrumen} · {formatTradeId(closingTrade.trade_number)}
                </h3>
              </div>
              <button onClick={resetClose} className="text-adm-ink-dim hover:text-adm-ink-hi" title="Cancel" aria-label="Cancel">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Net P&L (USD)</label>
                <input type="number" value={closePnl} onChange={e => setClosePnl(e.target.value)} className={inputCls} placeholder="e.g. 120.50 or -45" autoFocus />
              </div>
              <div>
                <label className={labelCls}>Exit price (optional)</label>
                <input type="number" value={closeExit} onChange={e => setCloseExit(e.target.value)} className={inputCls} placeholder="Leave blank to skip" />
              </div>
              <div>
                <label className={labelCls}>Close date</label>
                <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className={inputCls} />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleClosePosition(closingTrade.id)}
                  disabled={isProcessing}
                  className="flex-1 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-up disabled:opacity-40"
                >
                  {isProcessing ? 'Closing…' : 'Confirm close'}
                </button>
                <button onClick={resetClose} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-mid hover:bg-adm-bg2">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit drawer */}
      {editTrade && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,12,14,0.85)]" onClick={() => !isProcessing && setEditTrade(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-adm-line2 bg-adm-bg1 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-adm-ui text-adm-lg font-medium text-adm-ink-hi">Edit Position</h3>
              <button onClick={() => setEditTrade(null)} className="text-adm-ink-dim hover:text-adm-ink-hi" title="Close" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Instrument</label>
                <input type="text" value={editForm.instrumen} onChange={e => setEditForm(f => ({ ...f, instrumen: e.target.value }))} className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Position</label>
                <div className="flex gap-2">
                  {(['Buy', 'Sell'] as TradePosition[]).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEditForm(f => ({ ...f, posisi: p }))}
                      className={cn(
                        'flex-1 rounded-adm-sm border px-3 py-2 font-adm-data text-adm-xs uppercase',
                        editForm.posisi === p
                          ? p === 'Buy' ? 'border-adm-up bg-adm-up-fill text-adm-up' : 'border-adm-down bg-adm-down-fill text-adm-down'
                          : 'border-adm-line bg-adm-bg0 text-adm-ink-dim hover:text-adm-ink-mid'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Entry price</label>
                  <input type="number" value={editForm.harga_entry} onChange={e => setEditForm(f => ({ ...f, harga_entry: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Stop loss</label>
                  <input type="number" value={editForm.sl} onChange={e => setEditForm(f => ({ ...f, sl: e.target.value }))} placeholder="Optional" className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>Setup</label>
                <select value={editForm.setup} onChange={e => setEditForm(f => ({ ...f, setup: e.target.value }))} className={inputCls}>
                  <option value="">— None —</option>
                  {setupTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className={labelCls}>Psychology</label>
                <select value={editForm.psikologi} onChange={e => setEditForm(f => ({ ...f, psikologi: e.target.value }))} className={inputCls}>
                  <option value="">— None —</option>
                  {psychologyTags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSaveEdit}
                  disabled={isProcessing}
                  className="flex-1 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-up disabled:opacity-40"
                >
                  {isProcessing ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={() => setEditTrade(null)} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-mid hover:bg-adm-bg2">
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
