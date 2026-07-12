import { useState, useMemo, Fragment } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../lib/supabase';
import { useCryptoData } from '../../hooks/useCryptoData';
import { cn } from '../../lib/utils';
import { Plus, AlertTriangle, Check, X, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { calculateDeskBalances } from '../../lib/balanceCalc';
import { useCryptoPolling, useCryptoPriceMap, useCryptoFeedMeta, refreshCrypto } from '../../state/prices';
import { resolvePrice, spotMarkToMarket, spotUnrealized } from '../../lib/cryptoLivePnl';
import { useAuth } from '../../contexts/AuthProvider';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge } from '../../components/adm/StatusBadge';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { fmtUsd, fmtSignedUsd, fmtCryptoPrice, fmtNum } from '../../design/format';
import type { CryptoSpotSale } from '../../types';

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-2 py-1.5 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';
const thCls = 'px-3 py-2 text-left font-adm-data text-adm-micro uppercase text-adm-ink-dim';
const thR = `${thCls} text-right`;

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
  useCryptoPolling();
  const { spotHoldings, spotSales, refetch, cashFlows } = useCryptoData();
  const prices = useCryptoPriceMap();
  const feed = useCryptoFeedMeta();
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

  const feedSecs = feed.lastUpdated != null ? Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000)) : null;

  const saleColumns: Column<CryptoSpotSale>[] = [
    { key: 'tanggal', header: 'Date', width: '104px', cell: s => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(s.tanggal), 'dd MMM yy')}</span> },
    { key: 'coin', header: 'Coin', width: '80px', cell: s => <span className="font-adm-data text-adm-ink-hi">{s.coin}</span> },
    { key: 'jumlah_koin_sold', header: 'Qty sold', numeric: true, width: '100px', cell: s => fmtNum(s.jumlah_koin_sold, 6) },
    { key: 'harga_jual', header: 'Sell price', numeric: true, width: '110px', cell: s => fmtCryptoPrice(s.harga_jual) },
    { key: 'harga_beli_rata_at_sell', header: 'Avg cost', numeric: true, width: '110px', cell: s => <span className="text-adm-ink-mid">{fmtCryptoPrice(s.harga_beli_rata_at_sell)}</span> },
    { key: 'proceeds', header: 'Proceeds', numeric: true, width: '110px', sortValue: s => s.jumlah_koin_sold * s.harga_jual, cell: s => fmtUsd(s.jumlah_koin_sold * s.harga_jual) },
    { key: 'realized_pnl', header: 'Realized P&L', numeric: true, width: '120px', sortValue: s => s.realized_pnl, cell: s => <span className={s.realized_pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(s.realized_pnl)}</span> },
    { key: 'catatan', header: 'Notes', width: 'minmax(120px,1fr)', cell: s => <span className="font-adm-data text-adm-micro text-adm-ink-dim">{s.catatan || '—'}</span> },
  ];
  const salesTotal = spotSales.reduce((sum, s) => sum + Number(s.realized_pnl), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        desk="crypto"
        title="Spot Holdings"
        sub="long-term crypto positions"
        right={
          <div className="flex items-center gap-2">
            <StatusBadge kind={feed.status} detail={feed.status === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined} title="Binance feed" />
            <button onClick={refreshCrypto} title="Refresh prices" aria-label="Refresh prices" className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2">
              <RefreshCw className={cn('h-3.5 w-3.5', feed.status === 'loading' && 'animate-spin')} />
            </button>
            {isAdmin && !showForm && (
              <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-2 py-1 font-adm-data text-adm-micro uppercase text-adm-ink-hi hover:border-adm-desk-crypto">
                <Plus className="h-3 w-3" /> Add holding
              </button>
            )}
          </div>
        }
      />

      {formError && (
        <p className="flex items-start gap-2 rounded-adm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {formError}
        </p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-adm border border-adm-line bg-adm-bg1 p-4">
          <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{editingId ? 'Edit holding' : 'New holding'}</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={labelCls}>Coin</label>
              <input {...register('coin')} placeholder="e.g. BTC" className={inputCls} />
              {errors.coin && <span className="font-adm-data text-adm-micro text-adm-down">{errors.coin.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Quantity</label>
              <input type="number" step="any" {...register('jumlah_koin', { valueAsNumber: true })} className={inputCls} />
              {errors.jumlah_koin && <span className="font-adm-data text-adm-micro text-adm-down">{errors.jumlah_koin.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Avg buy price (USD)</label>
              <input type="number" step="any" {...register('harga_beli_rata', { valueAsNumber: true })} className={inputCls} />
              {errors.harga_beli_rata && <span className="font-adm-data text-adm-micro text-adm-down">{errors.harga_beli_rata.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Exchange / Wallet</label>
              <input {...register('exchange_wallet')} list="exchanges" placeholder="e.g. Binance" className={inputCls} />
              <datalist id="exchanges">{existingExchanges.map(e => <option key={e} value={e} />)}</datalist>
            </div>
            <div>
              <label className={labelCls}>Purchase date</label>
              <input type="date" {...register('tanggal_beli')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input {...register('catatan')} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={handleCancel} className="rounded-adm-sm border border-adm-line px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-mid hover:bg-adm-bg2">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-desk-crypto disabled:opacity-40">
              {isSubmitting ? 'Saving…' : editingId ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* Holdings table — hand-styled (inline sell expand + totals footer, which
          DataTable doesn't model). Re-renders on the Binance tick (live floating
          P&L per row); no transitions on the tick-updated cells. */}
      <div className="overflow-x-auto rounded-adm border border-adm-line bg-adm-bg1">
        <table className="w-full" style={{ minWidth: 1080 }}>
          <thead>
            <tr className="border-b border-adm-line2">
              <th className={thCls}>Coin</th>
              <th className={thR}>Qty</th>
              <th className={thR}>Avg price</th>
              <th className={thR}>Cost basis</th>
              <th className={thCls}>Exchange</th>
              <th className={thR}>Current price</th>
              <th className={thR}>Market value</th>
              <th className={thR}>Floating P&L</th>
              <th className={thR}>Actions</th>
            </tr>
          </thead>
          <tbody className="font-adm-data text-adm-sm">
            {spotHoldings.map(h => {
              const price = resolvePrice(prices, h.coin);
              const hasPrice = price != null;
              const floatingPnl = hasPrice ? spotUnrealized(h, price) : null;
              const costBasis = h.jumlah_koin * h.harga_beli_rata;
              return (
                <Fragment key={h.id}>
                  <tr className="border-b border-adm-line hover:bg-adm-bg2">
                    <td className="px-3 py-2 text-adm-ink-hi">{h.coin}</td>
                    <td className="px-3 py-2 text-right text-adm-ink-mid">{fmtNum(h.jumlah_koin, 6)}</td>
                    <td className="px-3 py-2 text-right text-adm-ink-mid">{fmtCryptoPrice(h.harga_beli_rata)}</td>
                    <td className="px-3 py-2 text-right text-adm-ink-mid">{fmtUsd(costBasis)}</td>
                    <td className="px-3 py-2 font-adm-ui text-adm-xs text-adm-ink-dim">{h.exchange_wallet}</td>
                    <td className="px-3 py-2 text-right text-adm-ink-hi">{hasPrice ? fmtCryptoPrice(price) : <span className="text-adm-ink-dim">—</span>}</td>
                    <td className="px-3 py-2 text-right text-adm-ink-hi">{hasPrice ? fmtUsd(spotMarkToMarket(h, price)) : <span className="text-adm-ink-dim">—</span>}</td>
                    <td className="px-3 py-2 text-right">{floatingPnl !== null ? <span className={floatingPnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(floatingPnl)}</span> : <span className="text-adm-ink-dim">—</span>}</td>
                    <td className="px-3 py-2 text-right">
                      {isAdmin && (
                        <span className="flex items-center justify-end gap-1">
                          <button onClick={() => beginSell(h)} disabled={sellingId !== null} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-desk-crypto hover:bg-adm-bg2 disabled:opacity-40" title="Sell">Sell</button>
                          <button onClick={() => handleEdit(h)} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2" title="Edit">Edit</button>
                          <button onClick={() => handleDelete(h)} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-down hover:bg-adm-bg2" title="Delete">Del</button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {sellingId === h.id && (() => {
                    const qty = parseFloat(sellQty);
                    const sprice = parseFloat(sellPrice);
                    const validQty = Number.isFinite(qty) && qty > 0 && qty <= h.jumlah_koin + 1e-12;
                    const validPrice = Number.isFinite(sprice) && sprice > 0;
                    const preview = validQty && validPrice ? (sprice - h.harga_beli_rata) * qty : null;
                    const isFull = validQty && Math.abs(qty - h.jumlah_koin) < 1e-12;
                    return (
                      <tr className="bg-adm-bg0">
                        <td colSpan={9} className="px-3 py-4">
                          <div className="space-y-3">
                            <p className="font-adm-data text-adm-micro uppercase text-adm-desk-crypto">
                              Sell {h.coin} — avg cost {fmtUsd(h.harga_beli_rata)}, holding {fmtNum(h.jumlah_koin, 6)}
                            </p>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                              <div><label className={labelCls}>Quantity</label><input type="number" step="any" value={sellQty} onChange={e => setSellQty(e.target.value)} className={inputCls} autoFocus /></div>
                              <div><label className={labelCls}>Sell price (USD)</label><input type="number" step="any" value={sellPrice} onChange={e => setSellPrice(e.target.value)} className={inputCls} placeholder="e.g. 65000" /></div>
                              <div><label className={labelCls}>Sell date</label><input type="date" value={sellDate} onChange={e => setSellDate(e.target.value)} className={inputCls} /></div>
                              <div className="md:col-span-2"><label className={labelCls}>Notes</label><input value={sellNotes} onChange={e => setSellNotes(e.target.value)} placeholder="Optional" className={inputCls} /></div>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="font-adm-data text-adm-xs text-adm-ink-dim">
                                {preview !== null ? (
                                  <>Realized P&L: <span className={preview < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(preview)}</span>{isFull && <span className="ml-2 text-adm-ink-dim">(full sell — holding removed)</span>}</>
                                ) : 'Enter quantity and price to preview realized P&L.'}
                              </p>
                              <span className="flex gap-2">
                                <button onClick={cancelSell} disabled={isSelling} className="flex items-center gap-1 rounded-adm-sm border border-adm-line px-3 py-1.5 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2"><X className="h-3 w-3" />Cancel</button>
                                <button onClick={() => handleSell(h)} disabled={isSelling || !validQty || !validPrice} className="flex items-center gap-1 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-3 py-1.5 font-adm-data text-adm-micro uppercase text-adm-ink-hi hover:border-adm-desk-crypto disabled:opacity-40"><Check className="h-3 w-3" />{isSelling ? 'Selling…' : 'Confirm sell'}</button>
                              </span>
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
              <tr><td colSpan={9} className="px-3 py-8 text-center font-adm-data text-adm-xs text-adm-ink-dim">No spot holdings yet.</td></tr>
            )}
          </tbody>
          {spotHoldings.length > 0 && (
            <tfoot className="border-t border-adm-line2 bg-adm-bg0 font-adm-data text-adm-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 font-adm-data text-adm-micro uppercase text-adm-ink-dim">Totals</td>
                <td className="px-3 py-2 text-right text-adm-ink-hi">{fmtUsd(totals.totalCost)}</td>
                <td /><td />
                <td className="px-3 py-2 text-right text-adm-ink-hi">{fmtUsd(totals.totalMarketValue)}</td>
                <td className="px-3 py-2 text-right"><span className={totals.totalUnrealized < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(totals.totalUnrealized)}</span></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Sales History — append-only realized log */}
      {spotSales.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Sales history</p>
            <p className="font-adm-data text-adm-xs text-adm-ink-mid">
              Total realized P&L <span className={salesTotal < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(salesTotal)}</span>
            </p>
          </div>
          <DataTable columns={saleColumns} rows={spotSales} rowKey={s => s.id} minWidth={900} empty="No sales yet." />
        </div>
      )}
    </div>
  );
}
