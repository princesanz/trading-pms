import { useState, useMemo } from 'react';
import { usePortfolioData } from '../hooks/useSupabase';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { RefreshCw, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthProvider';
import { recalculateBalances } from '../lib/forexBalances';
import { formatTradeId, formatUsd, formatPct, formatRr, formatNum, formatSession } from '../lib/tradeFormat';
import { sortClosedDesc } from '../lib/sortTrades';
import { PageHeader } from '../components/adm/PageHeader';
import { StatusBadge } from '../components/adm/StatusBadge';
import { DataTable, type Column } from '../components/adm/DataTable';
import { HScrollTable } from '../components/HScrollTable';
import { fmtSignedUsd, fmtPrice, fmtNum } from '../design/format';
import type { Trade } from '../types';

// XAUUSD is always quoted to 2 decimals; other FX pairs keep fmtPrice's 5-digit
// precision. Display-only — never used in any P&L computation.
const fmtInstrPrice = (v: number, instr: string) => (instr === 'XAUUSD' ? fmtNum(v, 2) : fmtPrice(v));

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

export function TradeHistory() {
  const { trades, loading, error: fetchError, refetch } = usePortfolioData();
  const { isAdmin } = useAuth();
  const [filterInstrument, setFilterInstrument] = useState('');
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [editPnl, setEditPnl] = useState<string>('');
  const [editExit, setEditExit] = useState<string>('');
  const [editDate, setEditDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const resetEdit = () => { setEditingTrade(null); setEditPnl(''); setEditExit(''); setEditDate(new Date().toISOString().split('T')[0]); };

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

  const columns: Column<Trade>[] = [
    { key: 'id', header: 'ID', width: '84px', sortValue: t => t.trade_number ?? null, cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-dim">{formatTradeId(t.trade_number)}</span> },
    { key: 'tanggal', header: 'Opened', width: '108px', sortValue: t => t.tanggal, cell: t => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(t.tanggal), 'dd MMM yyyy')}</span> },
    { key: 'instrumen', header: 'Instrument', width: '100px', cell: t => <span className="font-adm-data text-adm-ink-hi">{t.instrumen}</span> },
    { key: 'lot', header: 'Lot', numeric: true, width: '60px', cell: t => (t.lot != null ? t.lot.toFixed(2) : '—') },
    { key: 'posisi', header: 'Side', width: '76px', cell: t => <StatusBadge kind={t.posisi === 'Buy' ? 'long' : 'short'} label={t.posisi.toUpperCase()} /> },
    { key: 'harga_entry', header: 'Entry', numeric: true, width: '96px', cell: t => fmtInstrPrice(t.harga_entry ?? 0, t.instrumen) },
    {
      key: 'harga_exit', header: 'Exit', numeric: true, width: '96px',
      cell: t => t.harga_exit == null
        ? <span className="text-adm-ink-dim">—</span>
        : <span className={t.net_pnl != null && t.net_pnl > 0 ? 'text-adm-up' : t.net_pnl != null && t.net_pnl < 0 ? 'text-adm-down' : undefined}>{fmtInstrPrice(t.harga_exit, t.instrumen)}</span>,
    },
    { key: 'sl', header: 'SL', numeric: true, width: '90px', cell: t => (t.sl ? <span className="text-adm-down">{fmtInstrPrice(t.sl, t.instrumen)}</span> : <span className="text-adm-ink-dim">—</span>) },
    { key: 'tp', header: 'TP', numeric: true, width: '90px', cell: t => (t.tp ? <span className="text-adm-up">{fmtInstrPrice(t.tp, t.instrumen)}</span> : <span className="text-adm-ink-dim">—</span>) },
    // Widths sized to the longest real values so nowrap never overlaps neighbours:
    // SESSION max is the bounded enum "London/NY Overlap" (~152px incl. padding at
    // 11px/0.08em); SETUP·PSYCH is two concatenated free-text tags, floored at 300px
    // (fits e.g. "Liquidity Grab · FOMO / Revenge Trade") and grows via 1fr.
    { key: 'session', header: 'Session', width: '160px', cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-mid">{formatSession(t.session)}</span> },
    { key: 'tags', header: 'Setup · Psych', width: 'minmax(300px,1fr)', cell: t => <span className="font-adm-data text-adm-micro text-adm-ink-mid">{t.setup_tag?.name || '—'} · {t.psychology_tag?.name || '—'}</span> },
    { key: 'tanggal_tutup', header: 'Closed', width: '108px', sortValue: t => t.tanggal_tutup ?? null, cell: t => <span className="font-adm-data text-adm-ink-mid">{t.tanggal_tutup ? format(parseISO(t.tanggal_tutup), 'dd MMM yyyy') : '—'}</span> },
    { key: 'point_value', header: 'Pt val', numeric: true, width: '70px', cell: t => formatNum(t.point_value) },
    { key: 'risk_usd', header: 'Risk $', numeric: true, width: '86px', sortValue: t => t.risk_usd ?? null, cell: t => formatUsd(t.risk_usd) },
    { key: 'risk_pct', header: 'Risk %', numeric: true, width: '76px', cell: t => formatPct(t.risk_pct) },
    { key: 'rr_planned', header: 'R:R plan', numeric: true, width: '80px', cell: t => formatRr(t.rr_planned) },
    {
      key: 'rr_actual', header: 'R:R act', numeric: true, width: '80px', sortValue: t => t.rr_actual ?? null,
      cell: t => <span className={t.rr_actual == null ? 'text-adm-ink-dim' : t.rr_actual >= 0 ? 'text-adm-up' : 'text-adm-down'}>{formatRr(t.rr_actual)}</span>,
    },
    {
      key: 'net_pnl', header: 'Net P&L', numeric: true, width: '104px', sortValue: t => t.net_pnl ?? null,
      cell: t => t.net_pnl == null
        ? <span className="text-adm-ink-dim">—</span>
        : <span className={t.net_pnl > 0 ? 'text-adm-up' : t.net_pnl < 0 ? 'text-adm-down' : 'text-adm-ink-mid'}>{fmtSignedUsd(t.net_pnl)}</span>,
    },
    { key: 'persen_profit_loss', header: 'Gain %', numeric: true, width: '80px', sortValue: t => t.persen_profit_loss ?? null, cell: t => (t.persen_profit_loss != null ? `${t.persen_profit_loss.toFixed(2)}%` : '—') },
    {
      key: 'actions', header: '', width: '110px', align: 'right',
      cell: t => isAdmin ? (
        <span className="flex items-center justify-end gap-1">
          <button
            onClick={() => { setEditingTrade(t); setEditPnl(t.net_pnl?.toString() || ''); setEditExit(t.harga_exit?.toString() || ''); setEditDate(t.tanggal_tutup || new Date().toISOString().split('T')[0]); }}
            className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2"
            title="Edit PnL / exit"
          >
            Edit
          </button>
          <button
            onClick={() => handleDeleteTrade(t.id)}
            disabled={isProcessing}
            className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-down hover:bg-adm-bg2 disabled:opacity-40"
            title="Delete trade"
          >
            Del
          </button>
        </span>
      ) : null,
    },
  ];

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading journal…</div>;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="forex"
        title="Trade Journal"
        sub="closed trade history · realized P&L"
        right={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={handleRecalculate}
                disabled={isRecalculating}
                title="Re-derive every closed trade's account balance from cash flows + P&L"
                className="flex items-center gap-1.5 rounded-adm-sm border border-adm-line px-2 py-1 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2 disabled:opacity-40"
              >
                <RefreshCw className={cn('h-3 w-3', isRecalculating && 'animate-spin')} />
                {isRecalculating ? 'Recalculating…' : 'Recalculate'}
              </button>
            )}
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
          Failed to load journal data: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-adm-ink-hi">Retry</button>
        </p>
      )}

      {/* Pre-sorted by the shared comparator; header clicks re-sort by column.
          Always paginated at 10 rows/page (virtualization disabled here). */}
      <HScrollTable>
        <DataTable
          columns={columns}
          rows={filteredTrades}
          rowKey={t => t.id}
          minWidth={2060}
          noTruncate
          hScroll={false}
          pageSize={10}
          virtualizeOver={Infinity}
          rowHeight={42}
          empty="No closed trades in the journal yet."
        />
      </HScrollTable>

      {/* Edit drawer — same fields + mutation path as the old inline form. */}
      {editingTrade && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,12,14,0.85)]" onClick={() => !isProcessing && resetEdit()}>
          <div className="h-full w-full max-w-sm overflow-y-auto border-l border-adm-line2 bg-adm-bg1 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Edit closed trade</p>
                <h3 className="font-adm-ui text-adm-lg font-medium text-adm-ink-hi">
                  {editingTrade.instrumen} · {formatTradeId(editingTrade.trade_number)}
                </h3>
              </div>
              <button onClick={resetEdit} className="text-adm-ink-dim hover:text-adm-ink-hi" title="Cancel" aria-label="Cancel">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Net P&L (USD)</label>
                <input type="number" value={editPnl} onChange={e => setEditPnl(e.target.value)} className={inputCls} placeholder="e.g. 120.50 or -45" autoFocus />
              </div>
              <div>
                <label className={labelCls}>Exit price (optional)</label>
                <input type="number" value={editExit} onChange={e => setEditExit(e.target.value)} className={inputCls} placeholder="Leave blank to skip" />
              </div>
              <div>
                <label className={labelCls}>Close date</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className={inputCls} />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleEditTrade(editingTrade.id)}
                  disabled={isProcessing}
                  className="flex-1 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-up disabled:opacity-40"
                >
                  {isProcessing ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={resetEdit} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-mid hover:bg-adm-bg2">
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
