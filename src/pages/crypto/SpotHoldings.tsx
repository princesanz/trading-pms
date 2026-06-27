import { useState, useMemo, Fragment } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../lib/supabase';
import { useCryptoData } from '../../hooks/useCryptoData';
import { cn } from '../../lib/utils';
import { Plus, Edit2, Trash2, Wallet, AlertTriangle, DollarSign, Check, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { calculateDeskBalances } from '../../lib/balanceCalc';
import { useCryptoPrices } from '../../contexts/CryptoPriceProvider';
import { resolvePrice, spotMarkToMarket, spotUnrealized } from '../../lib/cryptoLivePnl';
import { PriceStatusBadge } from '../../components/PriceStatusBadge';
import { useAuth } from '../../contexts/AuthProvider';

const holdingSchema = z.object({
  tanggal_beli: z.string().min(1, 'Date is required'),
  coin: z.string().min(1, 'Coin is required'),
  jumlah_koin: z.number().positive('Quantity must be positive'),
  harga_beli_rata: z.number().positive('Price must be positive'),
  exchange_wallet: z.string().min(1, 'Exchange/Wallet is required'),
  catatan: z.string().optional(),
});

type HoldingFormValues = z.infer<typeof holdingSchema>;

export function SpotHoldings() {
  const { spotHoldings, spotSales, refetch, cashFlows } = useCryptoData();
  const { prices, status, lastUpdated, refresh } = useCryptoPrices();
  const { isAdmin } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Inline Sell form — one row at a time, mirrors FuturesJournal's Close pattern.
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellDate, setSellDate] = useState(new Date().toISOString().split('T')[0]);
  const [sellNotes, setSellNotes] = useState('');
  const [isSelling, setIsSelling] = useState(false);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<HoldingFormValues>({
    resolver: zodResolver(holdingSchema),
    defaultValues: {
      tanggal_beli: new Date().toISOString().split('T')[0],
    }
  });

  const existingExchanges = useMemo(() => {
    const set = new Set(spotHoldings.map(h => h.exchange_wallet));
    return Array.from(set);
  }, [spotHoldings]);

  const onSubmit = async (data: HoldingFormValues) => {
    setFormError(null);
    const newCost = data.jumlah_koin * data.harga_beli_rata;
    const catatan = `Buy ${data.jumlah_koin} ${data.coin} @ $${data.harga_beli_rata}`;

    // Balance check only applies to brand-new holdings (an edit may lower the cost).
    if (!editingId) {
      const cryptoBalances = calculateDeskBalances(cashFlows, 'Crypto');
      if (newCost > cryptoBalances.trading) {
        setFormError(`Insufficient Trading Account balance. Required: $${newCost.toLocaleString(undefined, {minimumFractionDigits: 2})} | Available: $${cryptoBalances.trading.toLocaleString(undefined, {minimumFractionDigits: 2})}. Transfer funds from your Funding Account first.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (!editingId) {
        // ── ADD ───────────────────────────────────────────────
        // Insert the holding first so we can stamp its id onto the linked cash flow.
        const { data: inserted, error: holdingErr } = await supabase
          .from('crypto_spot_holdings')
          .insert(data)
          .select('id')
          .single();
        if (holdingErr) throw holdingErr;

        const { error: cfErr } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal_beli,
          tipe: 'Withdraw',
          jumlah: newCost,
          desk: 'Crypto',
          currency: 'USD',
          account_type: 'Trading',
          related_id: inserted.id,
          is_trading_proceeds: true,
          catatan,
        });
        if (cfErr) {
          // Compensate: roll back the holding so we never leave an unfunded position.
          await supabase.from('crypto_spot_holdings').delete().eq('id', inserted.id);
          throw new Error(`Could not record the purchase cash flow, so the holding was not saved. Please try again. (${cfErr.message})`);
        }
      } else {
        // ── EDIT ──────────────────────────────────────────────
        const prev = spotHoldings.find(h => h.id === editingId);
        const oldCost = prev ? prev.jumlah_koin * prev.harga_beli_rata : null;

        // Step 1 (cash flow first): reconcile the linked Withdraw. If this fails we
        // abort before touching the holding, leaving everything consistent.
        let linked = (await supabase
          .from('cash_flows')
          .select('id, jumlah')
          .eq('related_id', editingId)
          .eq('tipe', 'Withdraw')
          .limit(1)
          .maybeSingle()).data as { id: string; jumlah: number } | null;

        // Legacy holdings have no related_id yet — adopt the original purchase row by
        // best-effort match (purchase date + coin + original cost), then it stays linked
        // going forward. Only adopt when EXACTLY one candidate matches; zero or several
        // (e.g. same coin/cost/date bought twice) fall through to the manual-review warning
        // below rather than risk linking the wrong row.
        if (!linked && prev && oldCost != null) {
          const { data: candidates } = await supabase
            .from('cash_flows')
            .select('id, jumlah, catatan, tanggal')
            .eq('desk', 'Crypto')
            .eq('tipe', 'Withdraw')
            .eq('account_type', 'Trading')
            .eq('tanggal', prev.tanggal_beli)
            .is('related_id', null);
          const matches = (candidates || []).filter(c =>
            Math.abs(Number(c.jumlah) - oldCost) < 0.005 && (c.catatan || '').includes(prev.coin)
          );
          if (matches.length === 1) {
            const match = matches[0];
            await supabase.from('cash_flows').update({ related_id: editingId }).eq('id', match.id);
            linked = { id: match.id, jumlah: match.jumlah };
          }
        }

        let revertCashFlow: (() => Promise<void>) | null = null;
        if (linked) {
          const linkedId = linked.id;
          const prevJumlah = Number(linked.jumlah);
          const { error } = await supabase.from('cash_flows')
            .update({ jumlah: newCost, catatan })
            .eq('id', linkedId);
          if (error) throw new Error(`Could not update the linked cash flow; the holding was left unchanged. Please try again. (${error.message})`);
          revertCashFlow = async () => { await supabase.from('cash_flows').update({ jumlah: prevJumlah }).eq('id', linkedId); };
        }

        // Step 2: update the holding itself.
        const { error: holdingErr } = await supabase.from('crypto_spot_holdings').update(data).eq('id', editingId);
        if (holdingErr) {
          if (revertCashFlow) {
            try {
              await revertCashFlow();
            } catch {
              throw new Error(`The holding update failed AND the cash-flow change could not be rolled back. Please manually check holding "${data.coin}" and its linked cash_flows row (related_id ${editingId}) for consistency. (${holdingErr.message})`);
            }
          }
          throw new Error(`Could not update the holding; the cash-flow change was rolled back, so nothing changed. Please try again. (${holdingErr.message})`);
        }

        // Holding updated. If no linked row was ever found, warn (non-fatal) so the
        // balance can be reconciled by hand.
        if (!linked) {
          setFormError(`Holding updated, but its original purchase cash-flow row could not be found to adjust automatically (legacy entry). Please review the Crypto Trading balance and the cash_flows for ${data.coin} manually.`);
        }
      }

      reset({ tanggal_beli: new Date().toISOString().split('T')[0] });
      setShowForm(false);
      setEditingId(null);
      refetch();
    } catch (e: any) {
      setFormError(e.message || String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (holding: typeof spotHoldings[0]) => {
    setEditingId(holding.id);
    setValue('tanggal_beli', holding.tanggal_beli);
    setValue('coin', holding.coin);
    setValue('jumlah_koin', holding.jumlah_koin);
    setValue('harga_beli_rata', holding.harga_beli_rata);
    setValue('exchange_wallet', holding.exchange_wallet);
    setValue('catatan', holding.catatan || '');
    setShowForm(true);
  };

  const handleDelete = async (holding: typeof spotHoldings[0]) => {
    if (!window.confirm('Delete this holding? An offsetting Deposit will be recorded to reverse the original purchase cost.')) return;
    setFormError(null);
    const cost = holding.jumlah_koin * holding.harga_beli_rata;
    try {
      // Step 1 (recoverable first): record the offsetting Deposit that reverses the
      // original purchase. If this fails, the holding is never touched.
      const { data: deposit, error: depErr } = await supabase.from('cash_flows').insert({
        tanggal: new Date().toISOString().split('T')[0],
        tipe: 'Deposit',
        jumlah: cost,
        desk: 'Crypto',
        currency: 'USD',
        account_type: 'Trading',
        related_id: holding.id,
        is_reversal: true,
        catatan: `Reversal: deleted holding ${holding.jumlah_koin} ${holding.coin} @ $${holding.harga_beli_rata}`,
      }).select('id').single();
      if (depErr) throw new Error(`Could not record the reversal cash flow. The holding was NOT deleted. Please try again. (${depErr.message})`);

      // Step 2: delete the holding. If this fails, roll back the Deposit we just added.
      const { error: delErr } = await supabase.from('crypto_spot_holdings').delete().eq('id', holding.id);
      if (delErr) {
        const { error: rollbackErr } = await supabase.from('cash_flows').delete().eq('id', deposit.id);
        if (rollbackErr) {
          throw new Error(`The holding could not be deleted AND the reversal Deposit could not be rolled back. Please manually delete the cash_flows Deposit for ${holding.coin} (related_id ${holding.id}) to keep your balance correct. (${delErr.message})`);
        }
        throw new Error(`Could not delete the holding; the reversal was rolled back, so nothing changed. Please try again. (${delErr.message})`);
      }
      refetch();
    } catch (e: any) {
      setFormError(e.message || String(e));
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setFormError(null);
    reset({ tanggal_beli: new Date().toISOString().split('T')[0] });
    setShowForm(false);
  };

  const beginSell = (holding: typeof spotHoldings[0]) => {
    setFormError(null);
    setSellingId(holding.id);
    setSellQty(String(holding.jumlah_koin));            // pre-fill full qty (most common case)
    const livePrice = resolvePrice(prices, holding.coin);
    setSellPrice(livePrice != null ? String(livePrice) : ''); // live price as a default, fully editable
    setSellDate(new Date().toISOString().split('T')[0]);
    setSellNotes('');
  };

  const cancelSell = () => {
    setSellingId(null);
    setSellQty('');
    setSellPrice('');
    setSellNotes('');
  };

  const handleSell = async (holding: typeof spotHoldings[0]) => {
    setFormError(null);
    const qty = parseFloat(sellQty);
    const price = parseFloat(sellPrice);

    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Enter a valid sell quantity (greater than zero).');
      return;
    }
    if (qty > holding.jumlah_koin + 1e-12) {
      setFormError(`Cannot sell more than you hold (${holding.jumlah_koin} ${holding.coin}).`);
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setFormError('Enter a valid sell price (greater than zero).');
      return;
    }
    if (!sellDate) {
      setFormError('Enter a sell date.');
      return;
    }

    const isFullSell = Math.abs(qty - holding.jumlah_koin) < 1e-12;
    const proceeds = qty * price;
    const avgAtSell = holding.harga_beli_rata;
    const realizedPnl = (price - avgAtSell) * qty;
    const catatan = sellNotes.trim() || `Sell ${qty} ${holding.coin} @ $${price}`;

    setIsSelling(true);
    try {
      // Step 1 (recoverable first): record the Sell-proceeds Deposit into Trading.
      const { data: cf, error: cfErr } = await supabase.from('cash_flows').insert({
        tanggal: sellDate,
        tipe: 'Deposit',
        jumlah: proceeds,
        desk: 'Crypto',
        currency: 'USD',
        account_type: 'Trading',
        is_trading_proceeds: true,            // excluded from Modal Awal (matches Saham Sell)
        catatan: `Sell ${qty} ${holding.coin} @ $${price}`,
      }).select('id').single();
      if (cfErr) throw new Error(`Could not record the sell-proceeds cash flow. The holding was NOT changed. Please try again. (${cfErr.message})`);

      // Step 2: append the immutable sales-log row. Snapshot the avg cost so realized
      // P&L stays anchored even if later DCA buys move the holding's avg.
      const { data: sale, error: saleErr } = await supabase.from('crypto_spot_sales').insert({
        tanggal: sellDate,
        coin: holding.coin,
        jumlah_koin_sold: qty,
        harga_jual: price,
        harga_beli_rata_at_sell: avgAtSell,
        realized_pnl: realizedPnl,
        catatan,
      }).select('id').single();
      if (saleErr) {
        const { error: rollbackErr } = await supabase.from('cash_flows').delete().eq('id', cf.id);
        if (rollbackErr) {
          throw new Error(`Could not record the sale log AND the cash-flow rollback failed. Please manually delete the proceeds Deposit for ${holding.coin} dated ${sellDate} to keep your balance correct. (${saleErr.message})`);
        }
        throw new Error(`Could not record the sale log; the cash flow was rolled back, so nothing changed. Please try again. (${saleErr.message})`);
      }

      // Step 3: shrink the holding (partial) or delete it (full).
      const { error: holdingErr } = isFullSell
        ? await supabase.from('crypto_spot_holdings').delete().eq('id', holding.id)
        : await supabase.from('crypto_spot_holdings').update({ jumlah_koin: holding.jumlah_koin - qty }).eq('id', holding.id);

      if (holdingErr) {
        // Roll back BOTH prior steps so we never leave a phantom sale with no holding change.
        const { error: saleRollbackErr } = await supabase.from('crypto_spot_sales').delete().eq('id', sale.id);
        const { error: cfRollbackErr } = await supabase.from('cash_flows').delete().eq('id', cf.id);
        if (saleRollbackErr || cfRollbackErr) {
          throw new Error(`The holding could not be ${isFullSell ? 'deleted' : 'updated'} AND a rollback step failed. Please manually delete the sale-log row and proceeds Deposit for ${holding.coin} dated ${sellDate} to keep your balance correct. (${holdingErr.message})`);
        }
        throw new Error(`Could not ${isFullSell ? 'remove' : 'shrink'} the holding; the sale and cash flow were rolled back, so nothing changed. Please try again. (${holdingErr.message})`);
      }

      cancelSell();
      refetch();
    } catch (e: any) {
      setFormError(e.message || String(e));
    } finally {
      setIsSelling(false);
    }
  };

  const totals = useMemo(() => {
    let totalCost = 0;
    let totalUnrealized = 0;
    spotHoldings.forEach(h => {
      totalCost += h.jumlah_koin * h.harga_beli_rata;
      totalUnrealized += spotUnrealized(h, resolvePrice(prices, h.coin));
    });
    return { totalCost, totalMarketValue: totalCost + totalUnrealized, totalUnrealized };
  }, [spotHoldings, prices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Spot Holdings</h2>
          <p className="text-slate-400 text-sm mt-1">Track your long-term crypto spot positions.</p>
        </div>
        <div className="flex items-center gap-3">
          <PriceStatusBadge status={status} lastUpdated={lastUpdated} onRefresh={refresh} />
          {isAdmin && !showForm && (
            <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors">
              <Plus className="w-4 h-4" /> Add Holding
            </button>
          )}
        </div>
      </div>

      {formError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg flex items-start gap-3 text-rose-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm opacity-90">{formError}</p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="font-medium text-slate-200">{editingId ? 'Edit Holding' : 'New Holding'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Coin</label>
              <input {...register('coin')} placeholder="e.g. BTC" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
              {errors.coin && <span className="text-xs text-red-500">{errors.coin.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Quantity</label>
              <input type="number" step="any" {...register('jumlah_koin', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
              {errors.jumlah_koin && <span className="text-xs text-red-500">{errors.jumlah_koin.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Avg Buy Price (USD)</label>
              <input type="number" step="any" {...register('harga_beli_rata', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
              {errors.harga_beli_rata && <span className="text-xs text-red-500">{errors.harga_beli_rata.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Exchange / Wallet</label>
              <input {...register('exchange_wallet')} list="exchanges" placeholder="e.g. Binance" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
              <datalist id="exchanges">{existingExchanges.map(e => <option key={e} value={e} />)}</datalist>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Purchase Date</label>
              <input type="date" {...register('tanggal_beli')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Notes</label>
              <input {...register('catatan')} placeholder="Optional" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={handleCancel} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50">
              {isSubmitting ? 'Saving...' : editingId ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Coin</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Avg Price</th>
              <th className="px-4 py-3">Cost Basis</th>
              <th className="px-4 py-3">Exchange</th>
              <th className="px-4 py-3 text-right">Current Price</th>
              <th className="px-4 py-3 text-right">Market Value</th>
              <th className="px-4 py-3 text-right">Floating P&L</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {spotHoldings.map(h => {
              const price = resolvePrice(prices, h.coin);
              const hasPrice = price != null;
              const floatingPnl = hasPrice ? spotUnrealized(h, price) : null;
              const costBasis = h.jumlah_koin * h.harga_beli_rata;

              return (
                <Fragment key={h.id}>
                <tr className="border-b border-slate-800/50 hover:bg-slate-800/20">
                  <td className="px-4 py-3 font-medium text-slate-200">{h.coin}</td>
                  <td className="px-4 py-3 text-slate-300">{h.jumlah_koin}</td>
                  <td className="px-4 py-3 text-slate-300">${h.harga_beli_rata.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-300">${costBasis.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-slate-400 flex items-center gap-1"><Wallet className="w-3 h-3" />{h.exchange_wallet}</td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {hasPrice ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}` : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {hasPrice ? `$${spotMarkToMarket(h, price).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {floatingPnl !== null ? (
                      <span className={cn('font-medium', floatingPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {floatingPnl >= 0 ? '+' : ''}${floatingPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => beginSell(h)} disabled={sellingId !== null} className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors disabled:opacity-50" title="Sell"><DollarSign className="w-3 h-3" />Sell</button>
                        <button onClick={() => handleEdit(h)} className="text-slate-400 hover:text-slate-200" title="Edit"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(h)} className="text-slate-400 hover:text-rose-400" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
                {sellingId === h.id && (() => {
                  const qty = parseFloat(sellQty);
                  const price = parseFloat(sellPrice);
                  const validQty = Number.isFinite(qty) && qty > 0 && qty <= h.jumlah_koin + 1e-12;
                  const validPrice = Number.isFinite(price) && price > 0;
                  const preview = validQty && validPrice ? (price - h.harga_beli_rata) * qty : null;
                  const isFull = validQty && Math.abs(qty - h.jumlah_koin) < 1e-12;
                  return (
                    <tr className="bg-slate-950/40">
                      <td colSpan={9} className="px-4 py-4">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <DollarSign className="w-3 h-3 text-amber-400" />
                            Sell {h.coin} — avg cost ${h.harga_beli_rata.toLocaleString()}, holding {h.jumlah_koin}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-slate-400">Quantity</label>
                              <input type="number" step="any" value={sellQty} onChange={(e) => setSellQty(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-amber-500" autoFocus />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-slate-400">Sell Price (USD)</label>
                              <input type="number" step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-amber-500" placeholder="e.g. 65000" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-slate-400">Sell Date</label>
                              <input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-amber-500" />
                            </div>
                            <div className="space-y-1 md:col-span-2">
                              <label className="text-xs font-medium text-slate-400">Notes</label>
                              <input value={sellNotes} onChange={(e) => setSellNotes(e.target.value)} placeholder="Optional" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-amber-500" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <div className="text-slate-400">
                              {preview !== null ? (
                                <>
                                  Realized P&L:{' '}
                                  <span className={cn('font-medium', preview >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                                    {preview >= 0 ? '+' : ''}${preview.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                  {isFull && <span className="ml-2 text-slate-500">(full sell — holding will be removed)</span>}
                                </>
                              ) : (
                                <span className="text-slate-500">Enter quantity and price to preview realized P&L.</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={cancelSell} disabled={isSelling} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 transition-colors"><X className="w-3 h-3" />Cancel</button>
                              <button onClick={() => handleSell(h)} disabled={isSelling || !validQty || !validPrice} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"><Check className="w-3 h-3" />{isSelling ? 'Selling…' : 'Confirm Sell'}</button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                </Fragment>
              );
            })}
            {spotHoldings.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No spot holdings yet.</td></tr>
            )}
          </tbody>
          {spotHoldings.length > 0 && (
            <tfoot className="border-t border-slate-700 bg-slate-950/30">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-medium text-slate-300">Totals</td>
                <td className="px-4 py-3 font-medium text-slate-200">${totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td></td>
                <td></td>
                <td className="px-4 py-3 text-right font-medium text-slate-200">${totals.totalMarketValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-3 text-right font-medium">
                  <span className={cn(totals.totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {totals.totalUnrealized >= 0 ? '+' : ''}${totals.totalUnrealized.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Sales History — append-only realized log */}
      {spotSales.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">Sales History</h3>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Coin</th>
                  <th className="px-4 py-3 text-right">Qty Sold</th>
                  <th className="px-4 py-3 text-right">Sell Price</th>
                  <th className="px-4 py-3 text-right">Avg Cost @ Sell</th>
                  <th className="px-4 py-3 text-right">Proceeds</th>
                  <th className="px-4 py-3 text-right">Realized P&L</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {spotSales.map(s => {
                  const proceeds = s.jumlah_koin_sold * s.harga_jual;
                  return (
                    <tr key={s.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                      <td className="px-4 py-3 text-slate-300">{format(parseISO(s.tanggal), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3 font-medium text-slate-200">{s.coin}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{s.jumlah_koin_sold}</td>
                      <td className="px-4 py-3 text-right text-slate-300">${s.harga_jual.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-400">${s.harga_beli_rata_at_sell.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-slate-300">${proceeds.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn('font-medium', s.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {s.realized_pnl >= 0 ? '+' : ''}${s.realized_pnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{s.catatan || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-700 bg-slate-950/30">
                <tr>
                  <td colSpan={6} className="px-4 py-3 font-medium text-slate-300">Total Realized P&L</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {(() => {
                      const total = spotSales.reduce((sum, s) => sum + Number(s.realized_pnl), 0);
                      return (
                        <span className={cn(total >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                          {total >= 0 ? '+' : ''}${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      );
                    })()}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
