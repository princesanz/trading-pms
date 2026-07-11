import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { queryClient } from '../../lib/queryClient';
import { calculateDeskBalances } from '../../lib/balanceCalc';
import { insertStockTransaction } from '../../lib/stockTransactionInsert';
import { PageHeader } from '../../components/adm/PageHeader';
import { fmtIdr } from '../../design/format';

const txSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  emiten: z.string().min(1, 'Ticker is required').transform(v => v.toUpperCase().trim()),
  market: z.enum(['IDX', 'US', 'CRYPTO']),
  tipe: z.enum(['Buy', 'Sell']),
  lot: z.number().positive('Lot must be positive'),
  harga: z.number().positive('Price must be positive'),
  komisi: z.number().min(0).optional(),
  analysis_tag: z.string().uuid().optional(),
  catatan: z.string().optional(),
});

type TxFormValues = z.infer<typeof txSchema>;

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

export function StockTransactionEntry() {
  const { holdings, analysisTags, cashFlows } = useEquitiesData();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<TxFormValues>({
    resolver: zodResolver(txSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
      market: 'IDX' as const,
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
    setIsSubmitting(true);

    // The insert path validates + writes (transaction → cash flow → recalc) and
    // returns { error } instead of throwing — same guard the CommandBar reuses.
    const { error } = await insertStockTransaction(
      {
        tanggal: data.tanggal,
        emiten: data.emiten,
        market: data.market,
        tipe: data.tipe,
        lot: data.lot,
        harga: data.harga,
        komisi: data.komisi || 0,
        analysis_tag: data.analysis_tag,
        catatan: data.catatan,
      },
      { holdings, cashFlows }
    );

    if (error) {
      setSellError(error.message);
      setIsSubmitting(false);
      return;
    }

    // History/portfolio data is cached forever (staleTime: Infinity) — invalidate
    // every table this flow wrote: the transaction, its cash-flow legs, and the
    // holding recalculated inside the insert path. Prefix ['cash_flows'] hits all
    // desk scopes.
    void queryClient.invalidateQueries({ queryKey: ['stock_transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['cash_flows'] });
    void queryClient.invalidateQueries({ queryKey: ['stock_holdings'] });
    navigate('/saham/history');
  };

  const tradingBalance = useMemo(() => calculateDeskBalances(cashFlows, 'Saham').trading, [cashFlows]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader desk="saham" title="Log Stock Transaction" sub="holdings & cash balance update automatically" />

      {sellError && (
        <p className="flex items-start gap-2 rounded-adm-sm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {sellError}
        </p>
      )}

      {watchTipe === 'Sell' && currentHolding && currentHolding.total_lot > 0 && (
        <p className="rounded-adm-sm border border-adm-desk-saham/30 bg-adm-bg2 px-3 py-2 font-adm-data text-adm-xs text-adm-ink-mid">
          Current holding: <span className="text-adm-ink-hi">{currentHolding.total_lot} lot</span> of {currentHolding.emiten} @ avg {fmtIdr(currentHolding.average_price)}
        </p>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 rounded-adm border border-adm-line bg-adm-bg1 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" {...register('tanggal')} className={inputCls} />
            {errors.tanggal && <span className="font-adm-data text-adm-micro text-adm-down">{errors.tanggal.message}</span>}
          </div>
          <div>
            <label className={labelCls}>Emiten (ticker)</label>
            <input type="text" placeholder="e.g. BBRI" {...register('emiten')} onChange={e => setValue('emiten', e.target.value.toUpperCase())} list="emitens" className={`${inputCls} uppercase`} />
            <datalist id="emitens">{existingEmitens.map(e => <option key={e} value={e} />)}</datalist>
            {errors.emiten && <span className="font-adm-data text-adm-micro text-adm-down">{errors.emiten.message}</span>}
          </div>
          <div>
            <label className={labelCls}>Market</label>
            <select {...register('market')} className={inputCls}>
              <option value="IDX">🇮🇩 IDX (Indonesia)</option>
              <option value="US">🇺🇸 US (NYSE/NASDAQ)</option>
              <option value="CRYPTO">₿ Crypto</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select {...register('tipe')} className={inputCls}>
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Lot (1 lot = 100 shares)</label>
            <input type="number" step="1" min="1" {...register('lot', { valueAsNumber: true })} className={inputCls} />
            {watchLot > 0 && <span className="font-adm-data text-adm-micro text-adm-ink-dim">{watchLot * 100} shares</span>}
            {errors.lot && <span className="font-adm-data text-adm-micro text-adm-down">{errors.lot.message}</span>}
          </div>
          <div>
            <label className={labelCls}>Price per share (Rp)</label>
            <input type="number" step="1" {...register('harga', { valueAsNumber: true })} className={inputCls} />
            {errors.harga && <span className="font-adm-data text-adm-micro text-adm-down">{errors.harga.message}</span>}
          </div>
          <div>
            <label className={labelCls}>Commission (Rp)</label>
            <input type="number" step="1" {...register('komisi', { valueAsNumber: true })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Analysis tag</label>
            <select {...register('analysis_tag')} className={inputCls}>
              <option value="">— Select tag —</option>
              {analysisTags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Analysis notes</label>
            <textarea {...register('catatan')} rows={3} className={`${inputCls} resize-none`} placeholder="Bandarmologi analysis, fundamental reasoning, technical setup…" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-adm-line pt-4">
          <span className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Trading balance: <span className="text-adm-ink-mid">{fmtIdr(tradingBalance)}</span></span>
          <button type="submit" disabled={isSubmitting} className="rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-6 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-desk-saham disabled:opacity-40">
            {isSubmitting ? 'Processing…' : 'Log transaction'}
          </button>
        </div>
      </form>
    </div>
  );
}
