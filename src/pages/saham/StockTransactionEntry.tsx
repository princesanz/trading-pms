import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Send, AlertTriangle } from 'lucide-react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { supabase } from '../../lib/supabase';
import { recalculateHolding } from '../../lib/stockCalc';
import { getCurrencyForDesk } from '../../types';
import { useNavigate } from 'react-router-dom';
import { calculateDeskBalances } from '../../lib/balanceCalc';

const txSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  emiten: z.string().min(1, 'Ticker is required').transform(v => v.toUpperCase().trim()),
  tipe: z.enum(['Buy', 'Sell']),
  lot: z.number().positive('Lot must be positive'),
  harga: z.number().positive('Price must be positive'),
  komisi: z.number().min(0).optional(),
  analysis_tag: z.string().uuid().optional(),
  catatan: z.string().optional(),
});

type TxFormValues = z.infer<typeof txSchema>;

export function StockTransactionEntry() {
  const { holdings, analysisTags, cashFlows } = useEquitiesData();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TxFormValues>({
    resolver: zodResolver(txSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
      tipe: 'Buy',
      komisi: 0,
    }
  });

  const watchTipe = watch('tipe');
  const watchEmiten = watch('emiten');
  const watchLot = watch('lot');

  const existingEmitens = useMemo(() => holdings.map(h => h.emiten), [holdings]);

  const currentHolding = useMemo(() => {
    if (!watchEmiten) return null;
    return holdings.find(h => h.emiten === watchEmiten.toUpperCase().trim()) || null;
  }, [holdings, watchEmiten]);

  const onSubmit = async (data: TxFormValues) => {
    setSellError(null);

    // Sell validation
    if (data.tipe === 'Sell') {
      const held = currentHolding?.total_lot || 0;
      if (data.lot > held) {
        setSellError(`Cannot sell ${data.lot} lot — you only hold ${held} lot of ${data.emiten}.`);
        return;
      }
    }

    // Buy validation
    if (data.tipe === 'Buy') {
      const grossValue = (data.lot * 100) * data.harga;
      const komisi = data.komisi || 0;
      const requiredCost = grossValue + komisi;
      
      const sahamBalances = calculateDeskBalances(cashFlows, 'Saham');
      
      if (requiredCost > sahamBalances.trading) {
        setSellError(`Insufficient Trading Account balance. Required: Rp${requiredCost.toLocaleString()} | Available: Rp${sahamBalances.trading.toLocaleString()}. Transfer funds from your Funding Account first.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      // 1. Insert transaction
      const { error } = await supabase.from('stock_transactions').insert({
        tanggal: data.tanggal,
        emiten: data.emiten,
        tipe: data.tipe,
        lot: data.lot,
        harga: data.harga,
        komisi: data.komisi || 0,
        analysis_tag: data.analysis_tag || null,
        catatan: data.catatan || null,
      });
      if (error) throw error;

      // 2. Record the linked cash flow (source of truth)
      const totalShares = data.lot * 100;
      const grossValue = totalShares * data.harga;
      const komisi = data.komisi || 0;

      if (data.tipe === 'Buy') {
        // Cash out: cost + commission
        const { error: cfError } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Withdraw',
          jumlah: grossValue + komisi,
          desk: 'Saham',
          currency: getCurrencyForDesk('Saham'),
          account_type: 'Trading',
          is_trading_proceeds: true,
          catatan: `Buy ${data.lot} lot ${data.emiten} @ ${data.harga.toLocaleString()}`,
        });
        if (cfError) throw cfError;
      } else {
        // Cash in: proceeds - commission
        const { error: cfError } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Deposit',
          jumlah: grossValue - komisi,
          desk: 'Saham',
          currency: getCurrencyForDesk('Saham'),
          account_type: 'Trading',
          is_trading_proceeds: true,
          catatan: `Sell ${data.lot} lot ${data.emiten} @ ${data.harga.toLocaleString()}`,
        });
        if (cfError) throw cfError;
      }

      // 3. Recalculate the derived holding LAST. recalculateHolding() re-derives from all
      // transactions (idempotent), so if it throws, the transaction and cash flow are
      // already saved and only the holdings summary is stale — the thrown message explains
      // how to recompute, and re-running self-heals.
      await recalculateHolding(data.emiten);

      navigate('/saham/history');
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Log Stock Transaction</h2>
        <p className="text-slate-400 text-sm mt-1">Record a Buy or Sell transaction. Holdings and cash balance will update automatically.</p>
      </div>

      {sellError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg flex items-start gap-3 text-rose-400">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium">Sell Validation Error</h4>
            <p className="text-sm opacity-90">{sellError}</p>
          </div>
        </div>
      )}

      {watchTipe === 'Sell' && currentHolding && currentHolding.total_lot > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
          Current holding: <strong>{currentHolding.total_lot} lot</strong> of {currentHolding.emiten} @ avg Rp{currentHolding.average_price.toLocaleString()}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Date</label>
            <input type="date" {...register('tanggal')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            {errors.tanggal && <span className="text-xs text-red-500">{errors.tanggal.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Emiten (Ticker)</label>
            <input type="text" placeholder="e.g. BBRI" {...register('emiten')} onChange={(e) => setValue('emiten', e.target.value.toUpperCase())} list="emitens" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none uppercase" />
            <datalist id="emitens">{existingEmitens.map(e => <option key={e} value={e} />)}</datalist>
            {errors.emiten && <span className="text-xs text-red-500">{errors.emiten.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Type</label>
            <select {...register('tipe')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none">
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Lot (1 lot = 100 shares)</label>
            <input type="number" step="1" min="1" {...register('lot', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            {watchLot > 0 && <span className="text-xs text-slate-500">{watchLot * 100} shares</span>}
            {errors.lot && <span className="text-xs text-red-500">{errors.lot.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Price per Share (Rp)</label>
            <input type="number" step="1" {...register('harga', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            {errors.harga && <span className="text-xs text-red-500">{errors.harga.message}</span>}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Commission (Rp)</label>
            <input type="number" step="1" {...register('komisi', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Analysis Tag</label>
            <select {...register('analysis_tag')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none">
              <option value="">-- Select Tag --</option>
              {analysisTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="col-span-1 md:col-span-2 space-y-2">
            <label className="text-sm font-medium text-slate-300">Analysis Notes</label>
            <textarea {...register('catatan')} rows={3} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none resize-none" placeholder="Bandarmologi analysis, fundamental reasoning, technical setup..." />
          </div>
        </div>
        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50">
            {isSubmitting ? 'Processing...' : 'Log Transaction'}
            {!isSubmitting && <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
