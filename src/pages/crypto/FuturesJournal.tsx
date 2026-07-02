import { useState, useMemo } from 'react';
import { useCryptoData } from '../../hooks/useCryptoData';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { Check, X, DollarSign, Trash2 } from 'lucide-react';
import { useCryptoPrices } from '../../contexts/CryptoPriceProvider';
import { resolvePrice, futuresUnrealized } from '../../lib/cryptoLivePnl';
import { PriceStatusBadge } from '../../components/PriceStatusBadge';
import { useAuth } from '../../contexts/AuthProvider';
import { normalizeCashFlowTipe } from '../../lib/balanceCalc';

async function recalculateCryptoBalances(overridePnl?: { tradeId: string; pnlValue: number }) {
  const { data: allTrades, error: tradesError } = await supabase
    .from('crypto_futures_trades')
    .select('*')
    .order('tanggal', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: cashFlows, error: cashFlowsError } = await supabase
    .from('cash_flows')
    .select('*')
    .eq('desk', 'Crypto')
    .order('tanggal', { ascending: true });

  // maybeSingle: a missing settings row (fresh migrated DB) must not hard-fail
  // the whole close/delete — we fall back to modal_awal_crypto = 0.
  const { data: settings, error: settingsError } = await supabase
    .from('account_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  const readError = tradesError || cashFlowsError || settingsError;
  if (readError) {
    throw new Error(`Could not load data to recalculate Crypto account balances. Balances were not updated — refresh the Journal and try again. (${readError.message})`);
  }
  if (!allTrades) return;

  let currentBalance: number = Number(settings?.modal_awal_crypto ?? 0);

  type Event = { type: 'trade'; date: number; createdAt: string; data: typeof allTrades[0] }
             | { type: 'cashflow'; date: number; createdAt: string; data: NonNullable<typeof cashFlows>[0] };

  const events: Event[] = [];
  allTrades.forEach(t => events.push({ type: 'trade', date: new Date(t.tanggal).getTime(), createdAt: t.created_at, data: t }));
  cashFlows?.forEach(cf => events.push({ type: 'cashflow', date: new Date(cf.tanggal).getTime(), createdAt: cf.created_at, data: cf }));
  events.sort((a, b) => a.date - b.date || a.createdAt.localeCompare(b.createdAt));

  const updates: { id: string; net_pnl: number; saldo_akun: number; persen_profit_loss: number; status: string }[] = [];

  for (const ev of events) {
    if (ev.type === 'cashflow') {
      const cf = ev.data;
      const tipe = normalizeCashFlowTipe(cf);
      if (tipe === 'Deposit' || tipe === 'Transfer Masuk') currentBalance += Number(cf.jumlah);
      else if (tipe === 'Withdraw' || tipe === 'Transfer Keluar') currentBalance -= Number(cf.jumlah);
    } else {
      const t = ev.data;
      let pnl: number | null = t.net_pnl;
      let newStatus = t.status;
      if (overridePnl && t.id === overridePnl.tradeId) {
        pnl = overridePnl.pnlValue;
        newStatus = 'Closed';
      }
      if (newStatus === 'Closed' && pnl !== null && pnl !== undefined) {
        const prevBalance = currentBalance;
        currentBalance += Number(pnl);
        const pct = prevBalance !== 0 ? (Number(pnl) / prevBalance) * 100 : 0;
        updates.push({ id: t.id, net_pnl: Number(pnl), saldo_akun: currentBalance, persen_profit_loss: pct, status: 'Closed' });
      }
    }
  }

  // Stop on the first failure: this re-derives every closed trade's balance from scratch,
  // so a partial run is fully fixed by re-running.
  let done = 0;
  for (const update of updates) {
    const { error: updateError } = await supabase.from('crypto_futures_trades').update({
      net_pnl: update.net_pnl, saldo_akun: update.saldo_akun, persen_profit_loss: update.persen_profit_loss, status: update.status,
    }).eq('id', update.id);
    if (updateError) {
      throw new Error(`Crypto balance recalculation failed after updating ${done} of ${updates.length} trade(s) (failed on trade ${update.id}). Balances are partially updated — refresh the Journal to recompute, or retry. (${updateError.message})`);
    }
    done++;
  }
}

export function FuturesJournal() {
  const { futuresTrades, loading, error: fetchError, refetch } = useCryptoData();
  const { prices, status, lastUpdated, refresh } = useCryptoPrices();
  const { isAdmin } = useAuth();
  const [filterCoin, setFilterCoin] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'Open' | 'Closed'>('');
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [closePnl, setClosePnl] = useState('');
  const [closeFunding, setCloseFunding] = useState('');
  const [closeExit, setCloseExit] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);

  const resetClose = () => { setClosingTradeId(null); setClosePnl(''); setCloseFunding(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); };

  const coins = useMemo(() => Array.from(new Set(futuresTrades.map(t => t.coin))), [futuresTrades]);

  const filtered = useMemo(() => {
    let result = futuresTrades;
    if (filterCoin) result = result.filter(t => t.coin === filterCoin);
    if (filterStatus) result = result.filter(t => t.status === filterStatus);
    return result.slice().reverse();
  }, [futuresTrades, filterCoin, filterStatus]);

  const handleClose = async (tradeId: string) => {
    const grossPnl = parseFloat(closePnl);
    if (isNaN(grossPnl)) { alert('Enter a valid PnL'); return; }
    const exitVal = closeExit.trim() === '' ? null : parseFloat(closeExit);
    if (closeExit.trim() !== '' && (exitVal == null || isNaN(exitVal) || exitVal <= 0)) { alert('Exit price must be a positive number (or left blank)'); return; }
    const closeDateVal = closeDate || new Date().toISOString().split('T')[0];
    setIsProcessing(true);
    try {
      const fundingValue = parseFloat(closeFunding) || 0;
      const finalNetPnl = grossPnl - fundingValue;

      // Save funding fee + exit metadata (harga_exit, tanggal_tutup) in one update.
      // net_pnl/status/saldo are set by the replay below.
      const metaUpdate: Record<string, unknown> = { harga_exit: exitVal, tanggal_tutup: closeDateVal };
      if (!isNaN(parseFloat(closeFunding)) && closeFunding.trim() !== '') metaUpdate.funding_rate_paid = fundingValue;
      const { error: metaError } = await supabase.from('crypto_futures_trades').update(metaUpdate).eq('id', tradeId);
      if (metaError) throw new Error(`Failed to save the close details for this position; balances were not recalculated. Refresh and try again. (${metaError.message})`);

      await recalculateCryptoBalances({ tradeId, pnlValue: finalNetPnl });
      resetClose();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteFutures = async (tradeId: string) => {
    if (!window.confirm('Delete this futures position? This cannot be undone. Crypto balances will be recalculated.')) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('crypto_futures_trades').delete().eq('id', tradeId);
      if (error) throw error;
      // Replay re-derives saldo_akun for the remaining closed positions from scratch.
      await recalculateCryptoBalances();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
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
        <h2 className="text-2xl font-bold tracking-tight">Futures Journal</h2>
        <div className="flex items-center gap-3">
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as '' | 'Open' | 'Closed')} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
            <option value="">All Status</option>
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>
          <select value={filterCoin} onChange={e => setFilterCoin(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
            <option value="">All Coins</option>
            {coins.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Coin</th>
              <th className="px-4 py-3">Pos</th>
              <th className="px-4 py-3">Notional</th>
              <th className="px-4 py-3">Lev</th>
              <th className="px-4 py-3">Entry</th>
              <th className="px-4 py-3">Exit</th>
              <th className="px-4 py-3 text-right">Mark</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Closed</th>
              <th className="px-4 py-3 text-right">Unrealized P&L</th>
              <th className="px-4 py-3 text-right">Net PnL</th>
              <th className="px-4 py-3 text-right">Gain %</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(trade => {
              const markPrice = trade.status === 'Open' ? resolvePrice(prices, trade.coin) : undefined;
              const uPnl = futuresUnrealized(trade, markPrice);
              const showUpnl = trade.status === 'Open' && markPrice != null;
              return (
              <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                <td className="px-4 py-3 text-slate-300">{format(parseISO(trade.tanggal), 'dd MMM yyyy')}</td>
                <td className="px-4 py-3 font-medium text-slate-200">{trade.coin}</td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-medium', trade.posisi === 'Long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400')}>{trade.posisi}</span>
                </td>
                <td className="px-4 py-3 text-slate-300">${trade.notional_usd.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-400">{trade.leverage}x</td>
                <td className="px-4 py-3 text-slate-300">{trade.harga_entry}</td>
                <td className="px-4 py-3 text-slate-300">{trade.harga_exit != null ? trade.harga_exit : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {showUpnl ? `$${markPrice!.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded text-xs font-medium', trade.status === 'Open' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-slate-700/30 text-slate-300 border border-slate-600/20')}>{trade.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-400">{trade.tanggal_tutup ? format(parseISO(trade.tanggal_tutup), 'dd MMM yyyy') : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right">
                  {showUpnl ? (
                    <span className={cn('font-medium', uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                      {uPnl >= 0 ? '+' : ''}${uPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {closingTradeId === trade.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <input type="number" value={closePnl} onChange={e => setClosePnl(e.target.value)} className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-cyan-500" placeholder="Gross PnL" autoFocus />
                      <input type="number" value={closeFunding} onChange={e => setCloseFunding(e.target.value)} className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-cyan-500" placeholder="Funding Fee" />
                      <input type="number" value={closeExit} onChange={e => setCloseExit(e.target.value)} className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-cyan-500" placeholder="Exit price (opt)" />
                      <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-cyan-500" title="Close date" />
                      <div className="flex gap-1">
                        <button onClick={() => handleClose(trade.id)} disabled={isProcessing} className="p-1 bg-cyan-600 rounded text-white hover:bg-cyan-500 disabled:opacity-50" title="Confirm"><Check className="w-3 h-3" /></button>
                        <button onClick={resetClose} className="p-1 bg-slate-700 rounded text-white hover:bg-slate-600" title="Cancel"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ) : (
                    <span className={cn('font-medium', trade.net_pnl != null && trade.net_pnl > 0 ? 'text-emerald-400' : trade.net_pnl != null && trade.net_pnl < 0 ? 'text-rose-400' : 'text-slate-500')}>
                      {trade.net_pnl != null ? `$${trade.net_pnl.toLocaleString()}` : '—'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{trade.persen_profit_loss != null ? `${trade.persen_profit_loss.toFixed(2)}%` : '—'}</td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && closingTradeId !== trade.id && (
                    <div className="flex items-center justify-end gap-2">
                      {trade.status === 'Open' && (
                        <button onClick={() => { setClosingTradeId(trade.id); setClosePnl(''); setCloseFunding(trade.funding_rate_paid?.toString() || ''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); }} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors" title="Close Position"><DollarSign className="w-3 h-3" />Close</button>
                      )}
                      {trade.status === 'Closed' && (
                        <button onClick={() => { setClosingTradeId(trade.id); setClosePnl(trade.net_pnl?.toString() || ''); setCloseFunding(trade.funding_rate_paid?.toString() || ''); setCloseExit(trade.harga_exit?.toString() || ''); setCloseDate(trade.tanggal_tutup || new Date().toISOString().split('T')[0]); }} className="text-slate-500 hover:text-slate-300 text-xs" title="Edit PnL / exit">Edit</button>
                      )}
                      <button onClick={() => handleDeleteFutures(trade.id)} disabled={isProcessing} className="text-slate-400 hover:text-rose-400 disabled:opacity-50" title="Delete position"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-slate-500">No futures trades found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
