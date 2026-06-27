import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertTriangle, Send } from 'lucide-react';
import { usePortfolioData } from '../hooks/useSupabase';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { getContractSize } from '../types';
import { calculateEffectiveTradingBalance } from '../lib/balanceCalc';

const tradeSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  instrumen: z.string().min(1, 'Instrument is required'),
  posisi: z.enum(['Buy', 'Sell']),
  lot: z.number().min(0.01),
  leverage: z.number().min(1, 'Leverage must be at least 1'),
  harga_entry: z.number().positive(),
  sl: z.number().positive().optional().or(z.literal(0)),
  tp: z.number().positive().optional().or(z.literal(0)),
  komisi_swap: z.number(),
  setup: z.string().uuid().optional(),
  psikologi: z.string().uuid().optional(),
  catatan: z.string().optional(),
});

type TradeFormValues = z.infer<typeof tradeSchema>;

export function TradeEntry() {
  const { trades, settings, setupTags, psychologyTags, cashFlows } = usePortfolioData();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<TradeFormValues>({
    resolver: zodResolver(tradeSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
      posisi: 'Buy',
      leverage: 100,
      komisi_swap: 0,
    }
  });

  const watchLot = watch('lot');
  const watchEntry = watch('harga_entry');
  const watchSL = watch('sl');
  const watchInstrumen = watch('instrumen');
  const watchLeverage = watch('leverage');

  const currentBalance = useMemo(() => {
    // Only consider closed trades with a saldo_akun for the current balance
    const closedWithBalance = trades.filter(t => t.status === 'Closed' && t.saldo_akun != null);
    if (closedWithBalance.length > 0) {
      return closedWithBalance[closedWithBalance.length - 1].saldo_akun || 0;
    }
    return settings?.modal_awal || 0;
  }, [trades, settings]);

  const riskWarning = useMemo(() => {
    if (!watchLot || !watchEntry || !watchSL || !currentBalance || !watchInstrumen) return null;
    
    // Use instrument-specific contract size for accurate risk calculation
    const contractSize = getContractSize(watchInstrumen);
    const riskAmount = Math.abs(watchEntry - watchSL) * watchLot * contractSize;
    const riskPercentage = (riskAmount / currentBalance) * 100;

    if (riskPercentage > 5) {
      return `Risk exceeds 5% of account balance (Est. Risk: $${riskAmount.toFixed(2)} / ${riskPercentage.toFixed(1)}% — using ${contractSize} units/lot for ${watchInstrumen.toUpperCase()})`;
    }
    return null;
  }, [watchLot, watchEntry, watchSL, watchInstrumen, currentBalance]);

  const balanceError = useMemo(() => {
    if (!watchLot || !watchEntry || !watchInstrumen || !watchLeverage) return null;
    const contractSize = getContractSize(watchInstrumen);
    // Margin-based cost: notional / leverage (matches the real broker, e.g. 1:100).
    const requiredCost = (watchLot * contractSize * watchEntry) / watchLeverage;

    // Same effective Trading balance shown on the dashboard: trading cash flows + realized P&L.
    const availableCash = calculateEffectiveTradingBalance(cashFlows, 'Forex', trades);

    if (requiredCost > availableCash) {
      return `Insufficient Trading Account balance. Required margin: $${requiredCost.toLocaleString(undefined, {minimumFractionDigits: 2})} | Available: $${availableCash.toLocaleString(undefined, {minimumFractionDigits: 2})}. Transfer funds from your Funding Account first.`;
    }
    return null;
  }, [watchLot, watchEntry, watchInstrumen, watchLeverage, cashFlows, trades]);

  const onSubmit = async (data: TradeFormValues) => {
    if (balanceError) return;
    setIsSubmitting(true);
    
    const riskToReward = data.sl && data.tp 
      ? (Math.abs(data.tp - data.harga_entry) / Math.abs(data.harga_entry - data.sl)).toFixed(2)
      : null;

    const { error } = await supabase.from('trades').insert({
      tanggal: data.tanggal,
      instrumen: data.instrumen,
      posisi: data.posisi,
      lot: data.lot,
      leverage: data.leverage,
      harga_entry: data.harga_entry,
      sl: data.sl || null,
      tp: data.tp || null,
      komisi_swap: data.komisi_swap,
      setup: data.setup || null,
      psikologi: data.psikologi || null,
      catatan: data.catatan,
      risk_to_reward: riskToReward ? `1:${riskToReward}` : null,
      status: 'Open',
      // net_pnl, persen_profit_loss, and saldo_akun stay null until trade is closed.
    });

    setIsSubmitting(false);

    if (error) {
      alert(`Error: ${error.message}`);
    } else {
      navigate('/journal');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Log New Trade</h2>
        <p className="text-slate-400 text-sm mt-1">Enter your trade details. P&L will be updated when the trade is closed.</p>
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
            <input 
              type="date" 
              {...register('tanggal')} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
            {errors.tanggal && <span className="text-xs text-red-500">{errors.tanggal.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Instrument</label>
            <select
              {...register('instrumen')}
              defaultValue=""
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              <option value="" disabled>-- Select Instrument --</option>
              <optgroup label="Commodities">
                <option value="XAUUSD">XAUUSD (Gold)</option>
              </optgroup>
              <optgroup label="Indices">
                <option value="DJI30">DJI30 — US30 / Dow Jones</option>
                <option value="NDX100">NDX100 — Nasdaq 100</option>
                <option value="SPX500">SPX500 — S&P 500</option>
              </optgroup>
              <optgroup label="Forex Majors">
                <option value="EURUSD">EURUSD</option>
                <option value="GBPUSD">GBPUSD</option>
                <option value="USDJPY">USDJPY</option>
                <option value="AUDUSD">AUDUSD</option>
                <option value="USDCAD">USDCAD</option>
                <option value="USDCHF">USDCHF</option>
                <option value="NZDUSD">NZDUSD</option>
              </optgroup>
            </select>
            {errors.instrumen && <span className="text-xs text-red-500">{errors.instrumen.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Position</label>
            <select 
              {...register('posisi')} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              <option value="Buy">Buy (Long)</option>
              <option value="Sell">Sell (Short)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Lot Size</label>
            <input 
              type="number" 
              step="0.01"
              {...register('lot', { valueAsNumber: true })} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
            {errors.lot && <span className="text-xs text-red-500">{errors.lot.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Entry Price</label>
            <input
              type="number"
              step="0.00001"
              {...register('harga_entry', { valueAsNumber: true })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Leverage</label>
            <input
              type="number"
              step="1"
              {...register('leverage', { valueAsNumber: true })}
              placeholder="e.g. 100 for 1:100"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
            {errors.leverage && <span className="text-xs text-red-500">{errors.leverage.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Stop Loss (SL)</label>
            <input 
              type="number" 
              step="0.00001"
              {...register('sl', { valueAsNumber: true })} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Take Profit (TP)</label>
            <input 
              type="number" 
              step="0.00001"
              {...register('tp', { valueAsNumber: true })} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Commission & Swap</label>
            <input 
              type="number" 
              step="0.01"
              {...register('komisi_swap', { valueAsNumber: true })} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Setup</label>
            <select 
              {...register('setup')} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              <option value="">-- Select Setup --</option>
              {setupTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Psychology State</label>
            <select 
              {...register('psikologi')} 
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
            >
              <option value="">-- Select State --</option>
              {psychologyTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          <div className="col-span-1 md:col-span-2 space-y-2">
            <label className="text-sm font-medium text-slate-300">Notes</label>
            <textarea 
              {...register('catatan')} 
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
              placeholder="Entry reasoning, context, etc."
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !!balanceError}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Log Trade'}
            {!isSubmitting && <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
