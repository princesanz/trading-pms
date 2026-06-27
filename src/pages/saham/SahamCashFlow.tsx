import { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../lib/supabase';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { calculateDeskBalances } from '../../lib/balanceCalc';
import { getCurrencyForDesk, convertAmount, roundForCurrency, formatCurrencyAmount } from '../../types';
import { AmountInput } from '../../components/AmountInput';
import { ArrowDownCircle, ArrowUpCircle, Wallet, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../../lib/utils';

type ActionMode = 'Deposit' | 'Withdraw' | 'Internal Transfer' | 'Cross-Desk Transfer';
type InternalDirection = 'funding-to-trading' | 'trading-to-funding';

const cashFlowSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  jumlah: z.number().positive('Amount must be positive'),
  catatan: z.string().optional(),
});

type CashFlowFormValues = z.infer<typeof cashFlowSchema>;

export function SahamCashFlow() {
  const { cashFlows, refetch } = useEquitiesData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('Deposit');
  const [internalDirection, setInternalDirection] = useState<InternalDirection>('funding-to-trading');
  const [crossDeskDest, setCrossDeskDest] = useState<string>('Forex');
  const [exchangeRate, setExchangeRate] = useState('');

  const sahamBalances = useMemo(() => calculateDeskBalances(cashFlows, 'Saham'), [cashFlows]);

  const { register, handleSubmit, watch, reset, control, formState: { errors } } = useForm<CashFlowFormValues>({
    resolver: zodResolver(cashFlowSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
    }
  });

  const watchJumlah = watch('jumlah');
  const currency = getCurrencyForDesk('Saham');

  // Cross-desk currency conversion. Saham is IDR and both destinations (Forex/Crypto) are
  // USD, so a cross-desk transfer here always needs a rate.
  const sourceCurrency = currency;
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
      if (watchJumlah > sahamBalances.funding) {
        return `Insufficient Funding Account balance. Required: Rp${watchJumlah.toLocaleString()} | Available: Rp${sahamBalances.funding.toLocaleString()}.`;
      }
    }

    if (actionMode === 'Internal Transfer') {
      if (internalDirection === 'funding-to-trading' && watchJumlah > sahamBalances.funding) {
        return `Insufficient Funding Account balance. Required: Rp${watchJumlah.toLocaleString()} | Available: Rp${sahamBalances.funding.toLocaleString()}.`;
      }
      if (internalDirection === 'trading-to-funding' && watchJumlah > sahamBalances.trading) {
        return `Insufficient Trading Account balance. Required: Rp${watchJumlah.toLocaleString()} | Available: Rp${sahamBalances.trading.toLocaleString()}.`;
      }
    }

    if (actionMode === 'Cross-Desk Transfer') {
      if (watchJumlah > sahamBalances.funding) {
        return `Insufficient Funding Account balance. Required: Rp${watchJumlah.toLocaleString()} | Available: Rp${sahamBalances.funding.toLocaleString()}.`;
      }
      if (crossDeskNeedsRate && !(rateNum > 0)) {
        return 'Enter a valid exchange rate (1 USD = … IDR).';
      }
    }

    return null;
  }, [watchJumlah, actionMode, internalDirection, sahamBalances, crossDeskNeedsRate, rateNum]);

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
          desk: 'Saham',
          currency,
          account_type: 'Funding',
          catatan: data.catatan || null,
        });
        if (error) throw error;
      } else if (actionMode === 'Withdraw') {
        const { error } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Withdraw',
          jumlah: data.jumlah,
          desk: 'Saham',
          currency,
          account_type: 'Funding',
          catatan: data.catatan || null,
        });
        if (error) throw error;
      } else if (actionMode === 'Internal Transfer') {
        const fromAccount = internalDirection === 'funding-to-trading' ? 'Funding' : 'Trading';
        const toAccount = internalDirection === 'funding-to-trading' ? 'Trading' : 'Funding';

        const { error } = await supabase.from('cash_flows').insert([
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Keluar',
            jumlah: data.jumlah,
            desk: 'Saham',
            currency,
            account_type: fromAccount,
            catatan: data.catatan || `Internal: ${fromAccount} → ${toAccount}`,
          },
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Masuk',
            jumlah: data.jumlah,
            desk: 'Saham',
            currency,
            account_type: toAccount,
            catatan: data.catatan || `Internal: ${fromAccount} → ${toAccount}`,
          },
        ]);
        if (error) throw error;
      } else if (actionMode === 'Cross-Desk Transfer') {
        if (crossDeskNeedsRate && !(rateNum > 0)) return; // belt-and-suspenders; liveError already blocks
        // Saham (IDR) → Forex/Crypto (USD): convert the destination amount at the entered rate.
        const destAmount = roundForCurrency(
          convertAmount(data.jumlah, sourceCurrency, destCurrency, rateNum),
          destCurrency
        );
        const { error } = await supabase.from('cash_flows').insert([
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Keluar',
            jumlah: data.jumlah,
            desk: 'Saham',
            desk_tujuan: crossDeskDest,
            currency: sourceCurrency,
            account_type: 'Funding',
            catatan: data.catatan || `Cross-desk: Saham → ${crossDeskDest}`,
          },
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Masuk',
            jumlah: destAmount,
            desk: crossDeskDest,
            desk_tujuan: 'Saham',
            currency: destCurrency,
            account_type: 'Funding',
            catatan: data.catatan || `Cross-desk: Saham → ${crossDeskDest}`,
          },
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

  const sahamCashFlows = cashFlows.filter(cf => cf.desk === 'Saham');

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Saham Cash Flow</h2>
        <p className="text-slate-400 text-sm mt-1">Manage deposits, withdrawals, and transfers for the Equities desk.</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
            <Wallet className="text-amber-500 w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-400">Funding Account</p>
            <p className="text-xl font-bold tracking-tight text-slate-100">Rp{sahamBalances.funding.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-0.5">External deposits & withdrawals</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
            <ArrowRightLeft className="text-amber-500 w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-400">Trading Account</p>
            <p className="text-xl font-bold tracking-tight text-slate-100">Rp{sahamBalances.trading.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-0.5">Available for stock transactions</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form Column */}
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            {/* Action Mode Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Action</label>
              <select
                value={actionMode}
                onChange={e => setActionMode(e.target.value as ActionMode)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
              >
                <option value="Deposit">Deposit (External → Funding)</option>
                <option value="Withdraw">Withdraw (Funding → External)</option>
                <option value="Internal Transfer">Internal Transfer (Funding ↔ Trading)</option>
                <option value="Cross-Desk Transfer">Cross-Desk Transfer</option>
              </select>
            </div>

            {/* Internal Transfer Direction */}
            {actionMode === 'Internal Transfer' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Direction</label>
                <select
                  value={internalDirection}
                  onChange={e => setInternalDirection(e.target.value as InternalDirection)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                >
                  <option value="funding-to-trading">Funding → Trading</option>
                  <option value="trading-to-funding">Trading → Funding</option>
                </select>
              </div>
            )}

            {/* Cross-Desk Destination */}
            {actionMode === 'Cross-Desk Transfer' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Destination Desk</label>
                <select
                  value={crossDeskDest}
                  onChange={e => setCrossDeskDest(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                >
                  <option value="Forex">Forex</option>
                  <option value="Crypto">Crypto</option>
                </select>
              </div>
            )}

            {/* Exchange Rate — Saham (IDR) to a USD desk always needs a rate */}
            {crossDeskNeedsRate && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300">Exchange Rate (1 USD = ? IDR)</label>
                <input
                  type="number"
                  step="any"
                  value={exchangeRate}
                  onChange={e => setExchangeRate(e.target.value)}
                  placeholder="16000"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                />
                {convertedAmount !== null && (
                  <p className="text-xs text-slate-400">
                    {formatCurrencyAmount(watchJumlah, sourceCurrency)} → ≈ {formatCurrencyAmount(convertedAmount, destCurrency)} (rate {rateNum.toLocaleString()})
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Date</label>
              <input
                type="date"
                {...register('tanggal')}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
              />
              {errors.tanggal && <span className="text-xs text-red-500">{errors.tanggal.message}</span>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Amount (Rp)</label>
              <Controller
                control={control}
                name="jumlah"
                render={({ field }) => (
                  <AmountInput
                    value={field.value}
                    onChange={field.onChange}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none"
                  />
                )}
              />
              {errors.jumlah && <span className="text-xs text-red-500">{errors.jumlah.message}</span>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-300">Notes</label>
              <textarea
                {...register('catatan')}
                rows={2}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none resize-none"
              />
            </div>

            {/* Validation Error */}
            {liveError && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/50 rounded-lg flex items-start gap-3 text-rose-400 mt-4">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-sm">Insufficient Balance</h4>
                  <p className="text-xs opacity-90">{liveError}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !!liveError}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 mt-4"
            >
              {isSubmitting ? 'Processing...' : 'Submit Transaction'}
            </button>
          </form>
        </div>

        {/* History Column */}
        <div className="lg:col-span-2">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-900/50">
              <h3 className="font-medium text-slate-200">Saham Cash Flow History</h3>
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
                  {[...sahamCashFlows].reverse().map((cf) => (
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
                            'font-medium',
                            cf.tipe.includes('Masuk') || cf.tipe === 'Deposit' ? 'text-emerald-400' : 'text-rose-400'
                          )}>
                            {cf.tipe}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          cf.account_type === 'Funding'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                        )}>
                          {cf.account_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-200">
                        Rp{Number(cf.jumlah).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {cf.tipe.includes('Transfer') && cf.desk_tujuan ? (
                          <span className="text-xs">{cf.desk} → {cf.desk_tujuan}</span>
                        ) : cf.catatan ? (
                          <span className="text-xs">{cf.catatan}</span>
                        ) : (
                          <span className="text-xs">{cf.desk}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sahamCashFlows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No cash flow transactions yet.</td>
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
