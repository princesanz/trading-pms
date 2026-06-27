import { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../lib/supabase';
import { usePortfolioData } from '../hooks/useSupabase';
import { getCurrencyForDesk, convertAmount, roundForCurrency, formatCurrencyAmount } from '../types';
import { AmountInput } from '../components/AmountInput';
import { calculateDeskBalances } from '../lib/balanceCalc';
import { ArrowRightLeft, ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';

type ActionMode = 'Deposit' | 'Withdraw' | 'Internal Transfer' | 'Cross-Desk Transfer';
type InternalDirection = 'funding_to_trading' | 'trading_to_funding';

const cashFlowSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  jumlah: z.number().positive('Amount must be positive'),
  catatan: z.string().optional(),
});

type CashFlowFormValues = z.infer<typeof cashFlowSchema>;

export function CashFlow() {
  const { cashFlows, refetch } = usePortfolioData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('Deposit');
  const [internalDirection, setInternalDirection] = useState<InternalDirection>('funding_to_trading');
  const [crossDeskDest, setCrossDeskDest] = useState<string>('Crypto');
  const [exchangeRate, setExchangeRate] = useState('');

  const forexBalances = useMemo(() => calculateDeskBalances(cashFlows, 'Forex'), [cashFlows]);

  const { register, handleSubmit, watch, reset, control, formState: { errors } } = useForm<CashFlowFormValues>({
    resolver: zodResolver(cashFlowSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
    }
  });

  const watchJumlah = watch('jumlah');

  // Cross-desk currency conversion (only when source/destination currencies differ)
  const sourceCurrency = getCurrencyForDesk('Forex');
  const destCurrency = getCurrencyForDesk(crossDeskDest);
  const crossDeskNeedsRate = actionMode === 'Cross-Desk Transfer' && sourceCurrency !== destCurrency;
  const rateNum = parseFloat(exchangeRate);
  const convertedAmount = crossDeskNeedsRate && watchJumlah > 0 && rateNum > 0
    ? roundForCurrency(convertAmount(watchJumlah, sourceCurrency, destCurrency, rateNum), destCurrency)
    : null;

  // Live validation - single source of truth
  const liveError = useMemo(() => {
    if (!watchJumlah || watchJumlah <= 0) return null;

    if (actionMode === 'Withdraw') {
      if (watchJumlah > forexBalances.funding) {
        return `Insufficient Funding balance. Available: $${forexBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
    }

    if (actionMode === 'Internal Transfer') {
      if (internalDirection === 'funding_to_trading' && watchJumlah > forexBalances.funding) {
        return `Insufficient Funding balance. Available: $${forexBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
      if (internalDirection === 'trading_to_funding' && watchJumlah > forexBalances.trading) {
        return `Insufficient Trading balance. Available: $${forexBalances.trading.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
    }

    if (actionMode === 'Cross-Desk Transfer') {
      if (watchJumlah > forexBalances.funding) {
        return `Insufficient Funding balance. Available: $${forexBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
      if (crossDeskNeedsRate && !(rateNum > 0)) {
        return 'Enter a valid exchange rate (1 USD = … IDR).';
      }
    }

    return null;
  }, [watchJumlah, actionMode, internalDirection, forexBalances, crossDeskNeedsRate, rateNum]);

  const onSubmit = async (data: CashFlowFormValues) => {
    // Blocking validation based solely on the liveError state
    if (liveError) return;
    setIsSubmitting(true);

    try {
      if (actionMode === 'Deposit') {
        const { error } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Deposit',
          jumlah: data.jumlah,
          desk: 'Forex',
          currency: getCurrencyForDesk('Forex'),
          account_type: 'Funding',
          catatan: data.catatan,
        });
        if (error) throw error;
      } else if (actionMode === 'Withdraw') {
        const { error } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Withdraw',
          jumlah: data.jumlah,
          desk: 'Forex',
          currency: getCurrencyForDesk('Forex'),
          account_type: 'Funding',
          catatan: data.catatan,
        });
        if (error) throw error;
      } else if (actionMode === 'Internal Transfer') {
        const sourceType = internalDirection === 'funding_to_trading' ? 'Funding' : 'Trading';
        const destType = internalDirection === 'funding_to_trading' ? 'Trading' : 'Funding';

        const { error } = await supabase.from('cash_flows').insert([
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Keluar',
            jumlah: data.jumlah,
            desk: 'Forex',
            currency: getCurrencyForDesk('Forex'),
            account_type: sourceType,
            catatan: data.catatan,
          },
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Masuk',
            jumlah: data.jumlah,
            desk: 'Forex',
            currency: getCurrencyForDesk('Forex'),
            account_type: destType,
            catatan: data.catatan,
          }
        ]);
        if (error) throw error;
      } else if (actionMode === 'Cross-Desk Transfer') {
        if (crossDeskNeedsRate && !(rateNum > 0)) return; // belt-and-suspenders; liveError already blocks
        // Destination amount is converted when currencies differ; convertAmount() returns
        // the amount unchanged for same-currency pairs, so this is 1:1 for Forex↔Crypto.
        const destAmount = roundForCurrency(
          convertAmount(data.jumlah, sourceCurrency, destCurrency, rateNum),
          destCurrency
        );
        const { error } = await supabase.from('cash_flows').insert([
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Keluar',
            jumlah: data.jumlah,
            desk: 'Forex',
            desk_tujuan: crossDeskDest,
            currency: sourceCurrency,
            account_type: 'Funding',
            catatan: data.catatan,
          },
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Masuk',
            jumlah: destAmount,
            desk: crossDeskDest,
            desk_tujuan: 'Forex',
            currency: destCurrency,
            account_type: 'Funding',
            catatan: data.catatan,
          }
        ]);
        if (error) throw error;
      }

      reset({ tanggal: data.tanggal, jumlah: 0, catatan: '' });
      setExchangeRate('');
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter history to only Forex desk entries
  const forexCashFlows = useMemo(
    () => cashFlows.filter(cf => cf.desk === 'Forex'),
    [cashFlows]
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cash Flow Management — Forex</h2>
        <p className="text-slate-400 text-sm mt-1">Manage deposits, withdrawals, and transfers for your Forex desk.</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Wallet className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-400">Funding Account</p>
            <p className="text-2xl font-bold tracking-tight text-slate-100">
              ${forexBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
            <TrendingUp className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-400">Trading Account</p>
            <p className="text-2xl font-bold tracking-tight text-slate-100">
              ${forexBalances.trading.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* Form Column */}
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">

            {/* Action Mode */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Action</label>
              <select
                value={actionMode}
                onChange={(e) => setActionMode(e.target.value as ActionMode)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="Deposit">Deposit (External → Funding)</option>
                <option value="Withdraw">Withdraw (Funding → External)</option>
                <option value="Internal Transfer">Internal Transfer (Funding ↔ Trading)</option>
                <option value="Cross-Desk Transfer">Cross-Desk Transfer (Forex → Other Desk)</option>
              </select>
            </div>

            {/* Internal Transfer Direction */}
            {actionMode === 'Internal Transfer' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Direction</label>
                <select
                  value={internalDirection}
                  onChange={(e) => setInternalDirection(e.target.value as InternalDirection)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                >
                  <option value="funding_to_trading">Funding → Trading</option>
                  <option value="trading_to_funding">Trading → Funding</option>
                </select>
              </div>
            )}

            {/* Cross-Desk Destination */}
            {actionMode === 'Cross-Desk Transfer' && (
              <div className="space-y-2 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 px-2 text-slate-500">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <label className="text-sm font-medium text-slate-300 mt-2 block">Destination Desk</label>
                <select
                  value={crossDeskDest}
                  onChange={(e) => setCrossDeskDest(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                >
                  <option value="Crypto">Crypto</option>
                  <option value="Saham">Saham</option>
                </select>
              </div>
            )}

            {/* Exchange Rate — only when source & destination currencies differ */}
            {crossDeskNeedsRate && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Exchange Rate (1 USD = ? IDR)</label>
                <input
                  type="number"
                  step="any"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  placeholder="16000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                />
                {convertedAmount !== null && (
                  <p className="text-xs text-slate-400">
                    {formatCurrencyAmount(watchJumlah, sourceCurrency)} → ≈ {formatCurrencyAmount(convertedAmount, destCurrency)} (rate {rateNum.toLocaleString()})
                  </p>
                )}
              </div>
            )}

            {/* Date */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Date</label>
              <input
                type="date"
                {...register('tanggal')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
              />
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Amount (USD)</label>
              <Controller
                control={control}
                name="jumlah"
                render={({ field }) => (
                  <AmountInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                )}
              />
              {errors.jumlah && <span className="text-xs text-red-500">{errors.jumlah.message}</span>}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Notes</label>
              <textarea
                {...register('catatan')}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
              />
            </div>

            {/* Validation Error */}
            {liveError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-start gap-2 text-rose-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-sm">{liveError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !!liveError}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 mt-2"
            >
              {isSubmitting ? 'Processing...' : 'Submit Transaction'}
            </button>
          </form>
        </div>

        {/* History Column */}
        <div className="lg:col-span-2">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50">
              <h3 className="font-medium text-slate-200">Recent Transactions — Forex</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {[...forexCashFlows].reverse().map((cf) => (
                    <tr key={cf.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                      <td className="px-4 py-3 text-slate-300">{format(parseISO(cf.tanggal), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {cf.tipe.includes('Masuk') || cf.tipe === 'Deposit' ? (
                            <ArrowDownCircle className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <ArrowUpCircle className="w-4 h-4 text-rose-500" />
                          )}
                          <span className={cn(
                            "font-medium",
                            cf.tipe.includes('Masuk') || cf.tipe === 'Deposit' ? "text-emerald-400" : "text-rose-400"
                          )}>
                            {cf.tipe}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          cf.account_type === 'Funding'
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                        )}>
                          {cf.account_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-200">
                        ${cf.jumlah.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {cf.tipe.includes('Transfer') && cf.desk_tujuan ? (
                          <span className="text-xs">{cf.desk} &rarr; {cf.desk_tujuan}</span>
                        ) : (
                          <span className="text-xs">{cf.desk}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {forexCashFlows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No Forex cash flow transactions yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
