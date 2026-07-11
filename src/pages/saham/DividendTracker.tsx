import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { Plus, CalendarClock, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { useAuth } from '../../contexts/AuthProvider';
import { PageHeader } from '../../components/adm/PageHeader';
import { MetricStrip } from '../../components/adm/MetricStrip';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { fmtIdr } from '../../design/format';
import type { Dividend } from '../../types';

const dividendSchema = z.object({
  tanggal_cum_date: z.string().min(1, 'Cum date is required'),
  tanggal_pembayaran: z.string().min(1, 'Payment date is required'),
  emiten: z.string().min(1, 'Emiten is required').transform(v => v.toUpperCase().trim()),
  jumlah_lembar: z.number().positive('Shares must be positive'),
  dividend_per_lembar: z.number().positive('Dividend per share must be positive'),
  pajak: z.number().min(0).optional(),
});

type DividendFormValues = z.infer<typeof dividendSchema>;

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

export function DividendTracker() {
  const { dividends, holdings, refetch } = useEquitiesData();
  const { isAdmin } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this dividend entry? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from('dividends').delete().eq('id', id);
      if (error) throw error;
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DividendFormValues>({
    resolver: zodResolver(dividendSchema),
    defaultValues: {
      tanggal_cum_date: new Date().toISOString().split('T')[0],
      tanggal_pembayaran: new Date().toISOString().split('T')[0],
      pajak: 0,
    }
  });

  const totalDividends = useMemo(() =>
    dividends.reduce((sum, d) => sum + (d.net_dividend || 0), 0),
  [dividends]);

  const upcomingCumDates = useMemo(() => {
    const today = startOfDay(new Date());
    return dividends.filter(d => isAfter(parseISO(d.tanggal_cum_date), today)).sort((a, b) => parseISO(a.tanggal_cum_date).getTime() - parseISO(b.tanggal_cum_date).getTime());
  }, [dividends]);

  const existingEmitens = useMemo(() => holdings.map(h => h.emiten), [holdings]);

  const onSubmit = async (data: DividendFormValues) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('dividends').insert({
        tanggal_cum_date: data.tanggal_cum_date,
        tanggal_pembayaran: data.tanggal_pembayaran,
        emiten: data.emiten,
        jumlah_lembar: data.jumlah_lembar,
        dividend_per_lembar: data.dividend_per_lembar,
        pajak: data.pajak || 0,
      });
      if (error) throw error;
      reset({ tanggal_cum_date: new Date().toISOString().split('T')[0], tanggal_pembayaran: new Date().toISOString().split('T')[0], pajak: 0 });
      setShowForm(false);
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const history = useMemo(() => [...dividends].sort((a, b) => Date.parse(b.tanggal_pembayaran) - Date.parse(a.tanggal_pembayaran)), [dividends]);

  const columns: Column<Dividend>[] = [
    { key: 'emiten', header: 'Emiten', width: 'minmax(72px,1fr)', cell: d => <span className="text-adm-ink-hi">{d.emiten}</span> },
    { key: 'tanggal_cum_date', header: 'Cum Date', width: '104px', sortValue: d => Date.parse(d.tanggal_cum_date), cell: d => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(d.tanggal_cum_date), 'dd MMM yy')}</span> },
    { key: 'tanggal_pembayaran', header: 'Payment', width: '104px', sortValue: d => Date.parse(d.tanggal_pembayaran), cell: d => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(d.tanggal_pembayaran), 'dd MMM yy')}</span> },
    { key: 'jumlah_lembar', header: 'Shares', numeric: true, width: '100px', sortValue: d => d.jumlah_lembar, cell: d => d.jumlah_lembar.toLocaleString('en-US') },
    { key: 'dividend_per_lembar', header: 'Div/Share', numeric: true, width: '110px', sortValue: d => d.dividend_per_lembar, cell: d => fmtIdr(d.dividend_per_lembar) },
    { key: 'total_dividend', header: 'Gross', numeric: true, width: '120px', sortValue: d => d.total_dividend, cell: d => fmtIdr(d.total_dividend) },
    { key: 'pajak', header: 'Tax', numeric: true, width: '100px', sortValue: d => d.pajak || 0, cell: d => d.pajak > 0 ? fmtIdr(d.pajak) : <span className="text-adm-ink-dim">—</span> },
    { key: 'net_dividend', header: 'Net', numeric: true, width: '120px', sortValue: d => d.net_dividend, cell: d => <span className="text-adm-up">{fmtIdr(d.net_dividend)}</span> },
    ...(isAdmin ? [{
      key: 'actions', header: '', width: '48px', align: 'right' as const,
      cell: (d: Dividend) => (
        <button onClick={() => handleDelete(d.id)} disabled={deletingId === d.id} className="text-adm-ink-dim hover:text-adm-down disabled:opacity-50" title="Delete dividend" aria-label="Delete dividend">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        desk="saham"
        title="Dividend Tracker"
        sub="income from stock holdings"
        right={isAdmin && !showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-3 py-1 font-adm-data text-adm-micro uppercase text-adm-ink-hi hover:border-adm-desk-saham">
            <Plus className="h-3.5 w-3.5" /> Log dividend
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MetricStrip
          className="lg:col-span-2"
          items={[
            { label: 'Total dividends', value: totalDividends, format: 'idr', emphasis: true, sub: `${dividends.length} entries` },
            { label: 'Upcoming cum dates', value: String(upcomingCumDates.length), tone: 'neutral', sub: 'not yet ex-date' },
          ]}
        />
        {upcomingCumDates.length > 0 && (
          <section className="rounded-adm border border-adm-line bg-adm-bg1 p-4">
            <div className="mb-2 flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-adm-desk-saham" />
              <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Upcoming cum dates</h3>
            </div>
            <ul className="space-y-1">
              {upcomingCumDates.slice(0, 5).map(d => (
                <li key={d.id} className="flex justify-between font-adm-data text-adm-xs">
                  <span className="text-adm-ink-hi">{d.emiten}</span>
                  <span className="text-adm-ink-mid">{format(parseISO(d.tanggal_cum_date), 'dd MMM yy')}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-adm border border-adm-line bg-adm-bg1 p-4">
          <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">New dividend entry</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className={labelCls}>Emiten</label>
              <input {...register('emiten')} placeholder="e.g. BBRI" list="div-emitens" className={`${inputCls} uppercase`} />
              <datalist id="div-emitens">{existingEmitens.map(e => <option key={e} value={e} />)}</datalist>
              {errors.emiten && <span className="font-adm-data text-adm-micro text-adm-down">{errors.emiten.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Cum date</label>
              <input type="date" {...register('tanggal_cum_date')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Payment date</label>
              <input type="date" {...register('tanggal_pembayaran')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Total shares</label>
              <input type="number" step="1" {...register('jumlah_lembar', { valueAsNumber: true })} className={inputCls} />
              {errors.jumlah_lembar && <span className="font-adm-data text-adm-micro text-adm-down">{errors.jumlah_lembar.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Dividend per share (Rp)</label>
              <input type="number" step="0.01" {...register('dividend_per_lembar', { valueAsNumber: true })} className={inputCls} />
              {errors.dividend_per_lembar && <span className="font-adm-data text-adm-micro text-adm-down">{errors.dividend_per_lembar.message}</span>}
            </div>
            <div>
              <label className={labelCls}>Tax (Rp)</label>
              <input type="number" step="1" {...register('pajak', { valueAsNumber: true })} className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); reset(); }} className="rounded-adm-sm px-3 py-1.5 font-adm-data text-adm-micro uppercase text-adm-ink-dim hover:text-adm-ink-mid">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-1.5 font-adm-data text-adm-micro uppercase text-adm-ink-hi hover:border-adm-desk-saham disabled:opacity-40">
              {isSubmitting ? 'Saving…' : 'Add dividend'}
            </button>
          </div>
        </form>
      )}

      <DataTable
        columns={columns}
        rows={history}
        rowKey={d => d.id}
        defaultSort={{ key: 'tanggal_pembayaran', dir: 'desc' }}
        minWidth={900}
        empty="No dividend entries yet."
      />
    </div>
  );
}
