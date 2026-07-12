import { useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../lib/supabase';
import { useCryptoData } from '../../hooks/useCryptoData';
import { getCurrencyForDesk, convertAmount, roundForCurrency, formatCurrencyAmount } from '../../types';
import { AmountInput } from '../../components/AmountInput';
import { calculateDeskBalances } from '../../lib/balanceCalc';
import { AlertTriangle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge } from '../../components/adm/StatusBadge';
import { MetricStrip } from '../../components/adm/MetricStrip';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { fmtSignedUsd } from '../../design/format';
import type { CashFlow as CashFlowRow } from '../../types';

type ActionMode = 'Deposit' | 'Withdraw' | 'Internal Transfer' | 'Cross-Desk Transfer';
type InternalDirection = 'funding_to_trading' | 'trading_to_funding';

const cashFlowSchema = z.object({
  tanggal: z.string().min(1, 'Date is required'),
  jumlah: z.number().positive('Amount must be positive'),
  catatan: z.string().optional(),
});

type CashFlowFormValues = z.infer<typeof cashFlowSchema>;

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

const isInflow = (tipe: string) => tipe.includes('Masuk') || tipe === 'Deposit';

export function CryptoCashFlow() {
  const { cashFlows, refetch } = useCryptoData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('Deposit');
  const [internalDirection, setInternalDirection] = useState<InternalDirection>('funding_to_trading');
  const [crossDeskDest, setCrossDeskDest] = useState<string>('Forex');
  const [exchangeRate, setExchangeRate] = useState('');

  const cryptoBalances = useMemo(() => calculateDeskBalances(cashFlows, 'Crypto'), [cashFlows]);

  const { register, handleSubmit, watch, reset, control, formState: { errors } } = useForm<CashFlowFormValues>({
    resolver: zodResolver(cashFlowSchema),
    defaultValues: {
      tanggal: new Date().toISOString().split('T')[0],
    }
  });

  const watchJumlah = watch('jumlah');

  // Cross-desk currency conversion (only when source/destination currencies differ)
  const sourceCurrency = getCurrencyForDesk('Crypto');
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
      if (watchJumlah > cryptoBalances.funding) {
        return `Insufficient Funding balance. Available: $${cryptoBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
    }

    if (actionMode === 'Internal Transfer') {
      if (internalDirection === 'funding_to_trading' && watchJumlah > cryptoBalances.funding) {
        return `Insufficient Funding balance. Available: $${cryptoBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
      if (internalDirection === 'trading_to_funding' && watchJumlah > cryptoBalances.trading) {
        return `Insufficient Trading balance. Available: $${cryptoBalances.trading.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
    }

    if (actionMode === 'Cross-Desk Transfer') {
      if (watchJumlah > cryptoBalances.funding) {
        return `Insufficient Funding balance. Available: $${cryptoBalances.funding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      }
      if (crossDeskNeedsRate && !(rateNum > 0)) {
        return 'Enter a valid exchange rate (1 USD = … IDR).';
      }
    }

    return null;
  }, [watchJumlah, actionMode, internalDirection, cryptoBalances, crossDeskNeedsRate, rateNum]);

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
          desk: 'Crypto',
          currency: getCurrencyForDesk('Crypto'),
          account_type: 'Funding',
          catatan: data.catatan,
        });
        if (error) throw error;
      } else if (actionMode === 'Withdraw') {
        const { error } = await supabase.from('cash_flows').insert({
          tanggal: data.tanggal,
          tipe: 'Withdraw',
          jumlah: data.jumlah,
          desk: 'Crypto',
          currency: getCurrencyForDesk('Crypto'),
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
            desk: 'Crypto',
            currency: getCurrencyForDesk('Crypto'),
            account_type: sourceType,
            catatan: data.catatan,
          },
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Masuk',
            jumlah: data.jumlah,
            desk: 'Crypto',
            currency: getCurrencyForDesk('Crypto'),
            account_type: destType,
            catatan: data.catatan,
          }
        ]);
        if (error) throw error;
      } else if (actionMode === 'Cross-Desk Transfer') {
        if (crossDeskNeedsRate && !(rateNum > 0)) return; // belt-and-suspenders; liveError already blocks
        // Destination amount is converted when currencies differ; convertAmount() returns
        // the amount unchanged for same-currency pairs, so this is 1:1 for Crypto↔Forex.
        const destAmount = roundForCurrency(
          convertAmount(data.jumlah, sourceCurrency, destCurrency, rateNum),
          destCurrency
        );
        const { error } = await supabase.from('cash_flows').insert([
          {
            tanggal: data.tanggal,
            tipe: 'Transfer Keluar',
            jumlah: data.jumlah,
            desk: 'Crypto',
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
            desk_tujuan: 'Crypto',
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

  // Filter history to only Crypto desk entries
  const cryptoCashFlows = useMemo(
    () => cashFlows.filter(cf => cf.desk === 'Crypto'),
    [cashFlows]
  );
  const history = useMemo(() => [...cryptoCashFlows].reverse(), [cryptoCashFlows]);

  const columns: Column<CashFlowRow>[] = [
    { key: 'tanggal', header: 'Date', width: '104px', cell: cf => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(cf.tanggal), 'dd MMM yy')}</span> },
    { key: 'tipe', header: 'Type', width: 'minmax(130px,1fr)', cell: cf => <span className={isInflow(cf.tipe) ? 'text-adm-up' : 'text-adm-down'}>{cf.tipe}</span> },
    { key: 'account_type', header: 'Account', width: '100px', cell: cf => <StatusBadge kind="neutral" label={cf.account_type.toUpperCase()} /> },
    { key: 'jumlah', header: 'Amount', numeric: true, width: '120px', sortValue: cf => cf.jumlah, cell: cf => <span className={isInflow(cf.tipe) ? 'text-adm-up' : 'text-adm-down'}>{fmtSignedUsd(isInflow(cf.tipe) ? cf.jumlah : -cf.jumlah)}</span> },
    { key: 'details', header: 'Details', width: 'minmax(110px,1fr)', cell: cf => <span className="font-adm-data text-adm-micro text-adm-ink-dim">{cf.tipe.includes('Transfer') && cf.desk_tujuan ? `${cf.desk} → ${cf.desk_tujuan}` : cf.desk}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader desk="crypto" title="Cash Flow" sub="deposits · withdrawals · transfers" />

      <MetricStrip
        items={[
          { label: 'Funding account', value: cryptoBalances.funding, format: 'usd', sub: 'external deposits' },
          { label: 'Trading account', value: cryptoBalances.trading, format: 'usd', sub: 'available to trade' },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-adm border border-adm-line bg-adm-bg1 p-4 lg:col-span-1">
          <div>
            <label className={labelCls}>Action</label>
            <select value={actionMode} onChange={e => setActionMode(e.target.value as ActionMode)} className={inputCls}>
              <option value="Deposit">Deposit (External → Funding)</option>
              <option value="Withdraw">Withdraw (Funding → External)</option>
              <option value="Internal Transfer">Internal Transfer (Funding ↔ Trading)</option>
              <option value="Cross-Desk Transfer">Cross-Desk Transfer (Crypto → Other Desk)</option>
            </select>
          </div>

          {actionMode === 'Internal Transfer' && (
            <div>
              <label className={labelCls}>Direction</label>
              <select value={internalDirection} onChange={e => setInternalDirection(e.target.value as InternalDirection)} className={inputCls}>
                <option value="funding_to_trading">Funding → Trading</option>
                <option value="trading_to_funding">Trading → Funding</option>
              </select>
            </div>
          )}

          {actionMode === 'Cross-Desk Transfer' && (
            <div>
              <label className={labelCls}>Destination desk</label>
              <select value={crossDeskDest} onChange={e => setCrossDeskDest(e.target.value)} className={inputCls}>
                <option value="Forex">Forex</option>
                <option value="Saham">Saham</option>
              </select>
            </div>
          )}

          {crossDeskNeedsRate && (
            <div>
              <label className={labelCls}>Exchange rate (1 USD = ? IDR)</label>
              <input type="number" step="any" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} placeholder="16000" className={inputCls} />
              {convertedAmount !== null && (
                <p className="mt-1 font-adm-data text-adm-micro text-adm-ink-dim">
                  {formatCurrencyAmount(watchJumlah, sourceCurrency)} → ≈ {formatCurrencyAmount(convertedAmount, destCurrency)} (rate {rateNum.toLocaleString()})
                </p>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>Date</label>
            <input type="date" {...register('tanggal')} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Amount (USD)</label>
            <Controller
              control={control}
              name="jumlah"
              render={({ field }) => (
                <AmountInput value={field.value} onChange={field.onChange} placeholder="0" className={inputCls} />
              )}
            />
            {errors.jumlah && <span className="font-adm-data text-adm-micro text-adm-down">{errors.jumlah.message}</span>}
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea {...register('catatan')} rows={2} className={`${inputCls} resize-none`} />
          </div>

          {liveError && (
            <p className="flex items-start gap-2 rounded-adm-sm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {liveError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !!liveError}
            className="w-full rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-desk-crypto disabled:opacity-40"
          >
            {isSubmitting ? 'Processing…' : 'Submit transaction'}
          </button>
        </form>

        <div className="lg:col-span-2">
          <p className="mb-2 font-adm-data text-adm-micro uppercase text-adm-ink-dim">Recent transactions — Crypto</p>
          <DataTable columns={columns} rows={history} rowKey={cf => cf.id} empty="No Crypto cash flow transactions yet." />
        </div>
      </div>
    </div>
  );
}
