import { useState, useMemo } from 'react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { format, parseISO } from 'date-fns';
import { cn } from '../../lib/utils';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { recalculateHolding } from '../../lib/stockCalc';
import { useAuth } from '../../contexts/AuthProvider';
import { getCurrencyForDesk } from '../../types';

export function StockHistory() {
  const { transactions, loading, error: fetchError, refetch } = useEquitiesData();
  const { isAdmin } = useAuth();
  const [filterEmiten, setFilterEmiten] = useState('');
  const [filterTipe, setFilterTipe] = useState<'' | 'Buy' | 'Sell'>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (tx: typeof transactions[0]) => {
    if (!window.confirm(`Delete this ${tx.tipe} transaction for ${tx.emiten}? This reverses its cash flow and recalculates the holding. This cannot be undone.`)) return;
    setDeletingId(tx.id);
    try {
      const grossValue = tx.lot * 100 * tx.harga;
      const komisi = tx.komisi || 0;
      // Reverse the linked Trading cash flow: a Buy was a Withdraw (cost + komisi),
      // a Sell was a Deposit (proceeds − komisi). Both hit the Trading account.
      const reversal = tx.tipe === 'Buy'
        ? { tipe: 'Deposit' as const, jumlah: grossValue + komisi }
        : { tipe: 'Withdraw' as const, jumlah: grossValue - komisi };

      // Step 1 (recoverable first): record the offsetting cash flow. If it fails, the
      // transaction is never touched.
      const { data: cf, error: cfError } = await supabase.from('cash_flows').insert({
        tanggal: tx.tanggal,
        tipe: reversal.tipe,
        jumlah: reversal.jumlah,
        desk: 'Saham',
        currency: getCurrencyForDesk('Saham'),
        account_type: 'Trading',
        is_reversal: true,
        catatan: `Reversal: deleted ${tx.tipe} ${tx.lot} lot ${tx.emiten} @ ${tx.harga.toLocaleString()}`,
      }).select('id').single();
      if (cfError) throw new Error(`Could not record the reversal cash flow. The transaction was NOT deleted. Please try again. (${cfError.message})`);

      // Step 2: delete the transaction. If it fails, roll back the reversal we just added.
      const { error: delError } = await supabase.from('stock_transactions').delete().eq('id', tx.id);
      if (delError) {
        const { error: rbError } = await supabase.from('cash_flows').delete().eq('id', cf.id);
        if (rbError) {
          throw new Error(`The transaction could not be deleted AND the reversal cash flow could not be rolled back. Please manually delete the reversal cash_flows row for ${tx.emiten} to keep your Trading balance correct. (${delError.message})`);
        }
        throw new Error(`Could not delete the transaction; the reversal was rolled back, so nothing changed. Please try again. (${delError.message})`);
      }

      // Step 3: recalculate the derived holding LAST (idempotent — replays remaining
      // transactions). If it throws, the transaction + reversal are already consistent and
      // only the holdings summary is stale; the thrown message explains how to recompute.
      await recalculateHolding(tx.emiten);
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const emitens = useMemo(() => Array.from(new Set(transactions.map(t => t.emiten))).sort(), [transactions]);

  const filtered = useMemo(() => {
    let result = transactions;
    if (filterEmiten) result = result.filter(t => t.emiten === filterEmiten);
    if (filterTipe) result = result.filter(t => t.tipe === filterTipe);
    return result.slice().reverse();
  }, [transactions, filterEmiten, filterTipe]);

  if (loading) return <div className="p-8 text-slate-400">Loading history...</div>;

  return (
    <div className="space-y-6">
      {fetchError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg text-rose-400 text-sm">
          Failed to load transaction data: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-rose-300">Retry</button>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Transaction History</h2>
          <p className="text-slate-400 text-sm mt-1">Full audit trail of all stock transactions with analysis notes.</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={filterTipe} onChange={e => setFilterTipe(e.target.value as '' | 'Buy' | 'Sell')} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none">
            <option value="">All Types</option>
            <option value="Buy">Buy</option>
            <option value="Sell">Sell</option>
          </select>
          <select value={filterEmiten} onChange={e => setFilterEmiten(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none">
            <option value="">All Emiten</option>
            {emitens.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Emiten</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Lot</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Analysis Tag</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(tx => {
              const value = tx.lot * 100 * tx.harga;
              return (
                <tr key={tx.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                  <td className="px-4 py-3 text-slate-300">{format(parseISO(tx.tanggal), 'dd MMM yyyy')}</td>
                  <td className="px-4 py-3 font-medium text-slate-200">{tx.emiten}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', tx.tipe === 'Buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400')}>{tx.tipe}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{tx.lot}</td>
                  <td className="px-4 py-3 text-slate-300">Rp{tx.harga.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-300">Rp{value.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-400">{tx.komisi > 0 ? `Rp${tx.komisi.toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3">
                    {tx.analysis_tag_obj ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">{tx.analysis_tag_obj.name}</span>
                    ) : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-xs">
                    {tx.catatan ? (
                      <p className="text-xs leading-relaxed line-clamp-2" title={tx.catatan}>{tx.catatan}</p>
                    ) : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && (
                      <button onClick={() => handleDelete(tx)} disabled={deletingId === tx.id} className="text-slate-400 hover:text-rose-400 disabled:opacity-50" title="Delete transaction">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No transactions found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
