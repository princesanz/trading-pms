import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AlertTriangle, Send } from 'lucide-react';
import { usePortfolioData } from '../hooks/useSupabase';
import { queryClient } from '../lib/queryClient';
import { useNavigate } from 'react-router-dom';
import { getContractSize } from '../types';
import { calculateEffectiveTradingBalance, calculateRealizedBalance } from '../lib/balanceCalc';
import { classifySession } from '../lib/session';
import { insertForexTrade } from '../lib/forexTradeInsert';
import { PageHeader } from '../components/adm/PageHeader';

const tradeSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  instrumen: z.string().min(1, 'Instrument is required'),
  category: z.enum(['forex', 'crypto', 'stock']),
  posisi: z.enum(['Buy', 'Sell']),
  lot: z.number().min(0.01),
  leverage: z.number().min(1, 'Leverage must be at least 1'),
  harga_entry: z.number().positive(),
  sl: z.number().positive().optional().or(z.literal(0)),
  tp: z.number().positive('Take Profit is required for R:R Planned'),
  komisi_swap: z.number(),
  setup: z.string().uuid().optional(),
  psikologi: z.string().uuid().optional(),
  catatan: z.string().optional(),
});

type TradeFormValues = z.infer<typeof tradeSchema>;

export function TradeEntry() {
  const { trades, settings, setupTags, psychologyTags, cashFlows, instrumentSpecs } = usePortfolioData();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<TradeFormValues>({
    resolver: zodResolver(tradeSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
      category: 'forex',
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
  const watchTp = watch('tp');

  // Point value snapshot source: instrument_specs (DB) with a fallback to the
  // static contract-size table so previews still work before the migration seed loads.
  const pointValue = useMemo(() => {
    if (!watchInstrumen) return null;
    const key = watchInstrumen.toUpperCase();
    const spec = instrumentSpecs.find(s => s.instrument.toUpperCase() === key);
    return spec ? Number(spec.point_value) : getContractSize(watchInstrumen);
  }, [watchInstrumen, instrumentSpecs]);

  // balance_at_open snapshot (realized-only: initial capital + net cash flows + realized P&L).
  const balanceAtOpen = useMemo(
    () => calculateRealizedBalance(settings?.modal_awal ?? 0, cashFlows, 'Forex', trades),
    [settings, cashFlows, trades]
  );

  // Predicted next TRADE ID for the preview (DB assigns the authoritative value on insert).
  const nextTradeNumber = useMemo(() => {
    const max = trades.reduce((m, t) => Math.max(m, t.trade_number ?? 0), 0);
    return max + 1;
  }, [trades]);

  // Session is derived from "now" (open time) — recomputed on submit so it stays exact.
  const previewSession = useMemo(() => classifySession(new Date()), []);

  const previewRiskUsd = useMemo(() => {
    if (!watchEntry || !watchSL || !watchLot || pointValue == null) return null;
    return Math.abs(watchEntry - watchSL) * pointValue * watchLot;
  }, [watchEntry, watchSL, watchLot, pointValue]);

  const previewRiskPct = useMemo(() => {
    if (previewRiskUsd == null || !balanceAtOpen) return null;
    return (previewRiskUsd / balanceAtOpen) * 100;
  }, [previewRiskUsd, balanceAtOpen]);

  const previewRrPlanned = useMemo(() => {
    if (!watchTp || !watchEntry || !watchSL) return null;
    const denom = Math.abs(watchEntry - watchSL);
    if (denom === 0) return null;
    return Math.abs(watchTp - watchEntry) / denom;
  }, [watchTp, watchEntry, watchSL]);

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

    // Shared insert path (lib/forexTradeInsert) — snapshots (open_ts, session,
    // balance_at_open, point_value) and riskToReward are computed there, verbatim
    // from the logic that used to live here. The CommandBar uses the same path.
    const insertResponse = await insertForexTrade(data, { settings, cashFlows, trades, instrumentSpecs });

    setIsSubmitting(false);

    if (insertResponse.error) {
      alert(`Error: ${insertResponse.error.message}`);
    } else {
      // Journal data is cached forever (staleTime: Infinity) — invalidating the
      // trades key is what makes the journal refetch on the next mount.
      void queryClient.invalidateQueries({ queryKey: ['trades'] });
      navigate('/journal');
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader desk="forex" title="Log New Trade" sub="P&L is recorded when the trade is closed" />

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
            <input 
              type="date" 
              {...register('tanggal')} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
            {errors.tanggal && <span className="font-adm-data text-adm-micro text-adm-down">{errors.tanggal.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Instrument</label>
            <select
              {...register('instrumen')}
              defaultValue=""
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
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
            {errors.instrumen && <span className="font-adm-data text-adm-micro text-adm-down">{errors.instrumen.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Category</label>
            <select
              {...register('category')}
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            >
              <option value="forex">Forex</option>
              <option value="crypto">Crypto</option>
              <option value="stock">Stock</option>
            </select>
            {errors.category && <span className="font-adm-data text-adm-micro text-adm-down">{errors.category.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Position</label>
            <select 
              {...register('posisi')} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            >
              <option value="Buy">Buy (Long)</option>
              <option value="Sell">Sell (Short)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Lot Size</label>
            <input 
              type="number" 
              step="0.01"
              {...register('lot', { valueAsNumber: true })} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
            {errors.lot && <span className="font-adm-data text-adm-micro text-adm-down">{errors.lot.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Entry Price</label>
            <input
              type="number"
              step="0.00001"
              {...register('harga_entry', { valueAsNumber: true })}
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Leverage</label>
            <input
              type="number"
              step="1"
              {...register('leverage', { valueAsNumber: true })}
              placeholder="e.g. 100 for 1:100"
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
            {errors.leverage && <span className="font-adm-data text-adm-micro text-adm-down">{errors.leverage.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Stop Loss (SL)</label>
            <input 
              type="number" 
              step="0.00001"
              {...register('sl', { valueAsNumber: true })} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Take Profit (TP)</label>
            <input
              type="number"
              step="0.00001"
              {...register('tp', { valueAsNumber: true })}
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
            {errors.tp && <span className="font-adm-data text-adm-micro text-adm-down">{errors.tp.message}</span>}
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Commission & Swap</label>
            <input 
              type="number" 
              step="0.01"
              {...register('komisi_swap', { valueAsNumber: true })} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Setup</label>
            <select 
              {...register('setup')} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            >
              <option value="">-- Select Setup --</option>
              {setupTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Psychology State</label>
            <select 
              {...register('psikologi')} 
              className="w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
            >
              <option value="">-- Select State --</option>
              {psychologyTags.map(tag => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>

          <div className="col-span-1 md:col-span-2 space-y-2">
            <label className="mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim">Notes</label>
            <textarea 
              {...register('catatan')} 
              rows={3}
              className="w-full resize-none rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none"
              placeholder="Entry reasoning, context, etc."
            />
          </div>
        </div>

        {/* Auto-computed preview — read-only. These mirror what the DB will store on insert. */}
        <div className="border-t border-adm-line pt-4">
          <h4 className="mb-3 font-adm-data text-adm-micro uppercase text-adm-ink-dim">Auto-computed</h4>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-adm border border-adm-line bg-adm-line md:grid-cols-4">
            <ComputedField label="Trade ID" value={`TRD-${nextTradeNumber}`} />
            <ComputedField label="Balance at Open" value={`$${balanceAtOpen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <ComputedField label="Session" value={previewSession} />
            <ComputedField label="Point Value" value={pointValue != null ? pointValue.toLocaleString() : '—'} />
            <ComputedField label="Risk USD" value={previewRiskUsd != null ? `$${previewRiskUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} />
            <ComputedField label="Risk %" value={previewRiskPct != null ? `${previewRiskPct.toFixed(2)}%` : '—'} />
            <ComputedField label="R:R Planned" value={previewRrPlanned != null ? `1:${previewRrPlanned.toFixed(2)}` : '—'} />
          </div>
          <p className="mt-3 font-adm-data text-adm-micro text-adm-ink-dim">
            Trade ID is a prediction; the final value is assigned by the database on save. Session and Balance are snapshotted at the moment you log the trade.
          </p>
        </div>

        <div className="flex justify-end border-t border-adm-line pt-4">
          <button
            type="submit"
            disabled={isSubmitting || !!balanceError}
            className="flex items-center gap-2 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-5 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-up disabled:opacity-40"
          >
            {isSubmitting ? 'Saving…' : 'Log trade'}
            {!isSubmitting && <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Read-only auto-computed field shown in the New Trade preview. */
function ComputedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-adm-bg0 px-3 py-2">
      <div className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{label}</div>
      <div className="truncate font-adm-data text-adm-sm text-adm-ink-hi" title={value}>{value}</div>
    </div>
  );
}
