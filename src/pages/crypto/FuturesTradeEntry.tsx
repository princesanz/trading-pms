import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertTriangle, Send } from 'lucide-react';
import { useCryptoData } from '../../hooks/useCryptoData';
import { queryClient } from '../../lib/queryClient';
import { useNavigate } from 'react-router-dom';
import { calculateEffectiveTradingBalance } from '../../lib/balanceCalc';
import { insertCryptoFuturesTrade } from '../../lib/cryptoFuturesInsert';
import { PageHeader } from '../../components/adm/PageHeader';

const futuresSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  coin: z.string().min(1, 'Coin pair is required'),
  posisi: z.enum(['Long', 'Short']),
  notional_usd: z.number().positive('Notional must be positive'),
  leverage: z.number().min(1, 'Leverage must be at least 1'),
  margin_mode: z.enum(['Cross', 'Isolated']),
  harga_entry: z.number().positive(),
  sl: z.number().positive().optional().or(z.literal(0)),
  tp: z.number().positive().optional().or(z.literal(0)),
  liquidation_price: z.number().positive().optional().or(z.literal(0)),
  funding_rate_paid: z.number().optional(),
  setup: z.string().uuid().optional(),
  psikologi: z.string().uuid().optional(),
  catatan: z.string().optional(),
});

type FuturesFormValues = z.infer<typeof futuresSchema>;

export function FuturesTradeEntry() {
  const { futuresTrades, settings, setupTags, psychologyTags, cashFlows } = useCryptoData();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FuturesFormValues>({
    resolver: zodResolver(futuresSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
      posisi: 'Long',
      leverage: 10,
      margin_mode: 'Isolated',
      funding_rate_paid: 0,
    }
  });

  const watchNotional = watch('notional_usd');
  const watchEntry = watch('harga_entry');
  const watchSL = watch('sl');
  const watchLeverage = watch('leverage');

  const currentBalance = useMemo(() => {
    const closedWithBalance = futuresTrades.filter(t => t.status === 'Closed' && t.saldo_akun != null);
    if (closedWithBalance.length > 0) {
      return closedWithBalance[closedWithBalance.length - 1].saldo_akun || 0;
    }
    return settings?.modal_awal_crypto || 0;
  }, [futuresTrades, settings]);

  const riskWarning = useMemo(() => {
    if (!watchNotional || !watchEntry || !watchSL || !currentBalance) return null;
    // notional_usd = full leveraged exposure. Risk = price move % × notional.
    const riskAmount = (Math.abs(watchEntry - watchSL) / watchEntry) * watchNotional * (watchLeverage || 1);
    const riskPercentage = (riskAmount / currentBalance) * 100;
    if (riskPercentage > 5) {
      const margin = watchNotional / (watchLeverage || 1);
      return `Risk exceeds 5% of account balance (Est. Risk: $${riskAmount.toFixed(2)} / ${riskPercentage.toFixed(1)}% — Notional: $${watchNotional.toLocaleString()}, Margin: $${margin.toFixed(2)} at ${watchLeverage}x)`;
    }
    return null;
  }, [watchNotional, watchEntry, watchSL, watchLeverage, currentBalance]);

  const balanceError = useMemo(() => {
    if (!watchNotional || !watchLeverage) return null;
    const requiredCost = watchNotional / watchLeverage;
    
    // Same effective Trading balance shown on the dashboard: trading cash flows + realized P&L.
    const availableCash = calculateEffectiveTradingBalance(cashFlows, 'Crypto', futuresTrades);

    if (requiredCost > availableCash) {
      return `Insufficient Trading Account balance. Required: $${requiredCost.toLocaleString(undefined, {minimumFractionDigits: 2})} | Available: $${availableCash.toLocaleString(undefined, {minimumFractionDigits: 2})}. Transfer funds from your Funding Account first.`;
    }
    return null;
  }, [watchNotional, watchLeverage, cashFlows, futuresTrades]);

  const onSubmit = async (data: FuturesFormValues) => {
    if (balanceError) return;
    setIsSubmitting(true);
    // Shared insert path (lib/cryptoFuturesInsert) — same payload as before; the
    // CommandBar uses it too.
    const insertResponse = await insertCryptoFuturesTrade(data);

    setIsSubmitting(false);
    if (insertResponse.error) { alert(`Error: ${insertResponse.error.message}`); }
    else {
      // Journal data is cached forever (staleTime: Infinity) — invalidating the
      // table key is what makes the journal refetch on the next mount.
      void queryClient.invalidateQueries({ queryKey: ['crypto_futures_trades'] });
      navigate('/crypto/futures/journal');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader desk="crypto" title="Log Futures Position" sub="P&L is recorded when the position is closed" />

      {balanceError && (
        <p className="flex items-start gap-2 rounded-adm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><span className="uppercase">Insufficient balance</span> — {balanceError}</span>
        </p>
      )}

      {riskWarning && (
        <p className="flex items-start gap-2 rounded-adm border border-adm-desk-forex/40 bg-adm-bg1 px-3 py-2 font-adm-data text-adm-xs text-adm-desk-forex">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><span className="uppercase">Risk alert</span> — {riskWarning}</span>
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 rounded-adm border border-adm-line bg-adm-bg1 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Date</label>
            <input type="date" {...register('tanggal')} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
            {errors.tanggal && <span className="font-adm-data text-adm-micro text-adm-down">{errors.tanggal.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Coin Pair</label>
            <input type="text" placeholder="e.g. BTCUSDT" {...register('coin')} onChange={(e) => setValue('coin', e.target.value.toUpperCase())} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm uppercase text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
            {errors.coin && <span className="font-adm-data text-adm-micro text-adm-down">{errors.coin.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Position</label>
            <select {...register('posisi')} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none">
              <option value="Long">Long</option>
              <option value="Short">Short</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Notional Value (USD)</label>
            <input type="number" step="0.01" {...register('notional_usd', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
            {watchNotional && watchLeverage ? <span className="font-adm-data text-adm-micro text-adm-ink-dim">Margin ≈ ${(watchNotional / watchLeverage).toFixed(2)} at {watchLeverage}x</span> : null}
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Leverage</label>
            <input type="number" step="1" min="1" {...register('leverage', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Margin Mode</label>
            <select {...register('margin_mode')} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none">
              <option value="Isolated">Isolated</option>
              <option value="Cross">Cross</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Entry Price</label>
            <input type="number" step="any" {...register('harga_entry', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Stop Loss</label>
            <input type="number" step="any" {...register('sl', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Take Profit</label>
            <input type="number" step="any" {...register('tp', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Liquidation Price</label>
            <input type="number" step="any" {...register('liquidation_price', { valueAsNumber: true })} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" />
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Setup</label>
            <select {...register('setup')} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none">
              <option value="">-- Select Setup --</option>
              {setupTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Psychology State</label>
            <select {...register('psikologi')} className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none">
              <option value="">-- Select State --</option>
              {psychologyTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="col-span-1 md:col-span-2 space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Notes</label>
            <textarea {...register('catatan')} rows={3} className="w-full resize-none rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none" placeholder="Entry reasoning, context, etc." />
          </div>
        </div>
        <div className="flex justify-end border-t border-adm-line pt-4">
          <button type="submit" disabled={isSubmitting || !!balanceError} className="flex items-center gap-2 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-5 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-desk-crypto disabled:opacity-40">
            {isSubmitting ? 'Saving…' : 'Log position'}
            {!isSubmitting && <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </form>
    </div>
  );
}
