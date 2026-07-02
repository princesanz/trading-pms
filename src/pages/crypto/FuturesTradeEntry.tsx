import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertTriangle, Send } from 'lucide-react';
import { useCryptoData } from '../../hooks/useCryptoData';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { calculateEffectiveTradingBalance } from '../../lib/balanceCalc';

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
    const insertResponse = await supabase.from('crypto_futures_trades').insert({
      tanggal: data.tanggal,
      coin: data.coin,
      posisi: data.posisi,
      notional_usd: data.notional_usd,
      leverage: data.leverage,
      margin_mode: data.margin_mode,
      harga_entry: data.harga_entry,
      sl: data.sl || null,
      tp: data.tp || null,
      liquidation_price: data.liquidation_price || null,
      funding_rate_paid: data.funding_rate_paid || 0,
      setup: data.setup || null,
      psikologi: data.psikologi || null,
      catatan: data.catatan,
      status: 'Open',
    }).select();

    setIsSubmitting(false);
    if (insertResponse.error) { alert(`Error: ${insertResponse.error.message}`); }
    else {
      // The journal page re-fetches on mount, so navigating shows the new position.
      navigate('/crypto/futures/journal');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Log Futures Position</h2>
        <p className="text-slate-400 text-sm mt-1">Enter your crypto futures trade. P&L will be updated when the position is closed.</p>
      </div>

      {balanceError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg flex items-start gap-3 text-rose-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium">Insufficient Balance</h4>
            <p className="text-sm opacity-90">{balanceError}</p>
          </div>
        </div>
      )}

      {riskWarning && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/50 rounded-lg flex items-start gap-3 text-orange-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium">Risk Alert</h4>
            <p className="text-sm opacity-90">{riskWarning}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Date</label>
            <input type="date" {...register('tanggal')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
            {errors.tanggal && <span className="text-xs text-red-500">{errors.tanggal.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Coin Pair</label>
            <input type="text" placeholder="e.g. BTCUSDT" {...register('coin')} onChange={(e) => setValue('coin', e.target.value.toUpperCase())} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none uppercase" />
            {errors.coin && <span className="text-xs text-red-500">{errors.coin.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Position</label>
            <select {...register('posisi')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value="Long">Long</option>
              <option value="Short">Short</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Notional Value (USD)</label>
            <input type="number" step="0.01" {...register('notional_usd', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
            {watchNotional && watchLeverage ? <span className="text-xs text-slate-500">Margin ≈ ${(watchNotional / watchLeverage).toFixed(2)} at {watchLeverage}x</span> : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Leverage</label>
            <input type="number" step="1" min="1" {...register('leverage', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Margin Mode</label>
            <select {...register('margin_mode')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value="Isolated">Isolated</option>
              <option value="Cross">Cross</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Entry Price</label>
            <input type="number" step="any" {...register('harga_entry', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Stop Loss</label>
            <input type="number" step="any" {...register('sl', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Take Profit</label>
            <input type="number" step="any" {...register('tp', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Liquidation Price</label>
            <input type="number" step="any" {...register('liquidation_price', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Setup</label>
            <select {...register('setup')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value="">-- Select Setup --</option>
              {setupTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Psychology State</label>
            <select {...register('psikologi')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none">
              <option value="">-- Select State --</option>
              {psychologyTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="col-span-1 md:col-span-2 space-y-2">
            <label className="text-sm font-medium text-slate-300">Notes</label>
            <textarea {...register('catatan')} rows={3} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-cyan-500 outline-none resize-none" placeholder="Entry reasoning, context, etc." />
          </div>
        </div>
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button type="submit" disabled={isSubmitting || !!balanceError} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
            {isSubmitting ? 'Saving...' : 'Log Position'}
            {!isSubmitting && <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
