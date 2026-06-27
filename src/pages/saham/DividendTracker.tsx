import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../../lib/supabase';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { Plus, CalendarClock, DollarSign, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthProvider';

const dividendSchema = z.object({
  tanggal_cum_date: z.string().min(1, 'Cum date is required'),
  tanggal_pembayaran: z.string().min(1, 'Payment date is required'),
  emiten: z.string().min(1, 'Emiten is required').transform(v => v.toUpperCase().trim()),
  jumlah_lembar: z.number().positive('Shares must be positive'),
  dividend_per_lembar: z.number().positive('Dividend per share must be positive'),
  pajak: z.number().min(0).optional(),
});

type DividendFormValues = z.infer<typeof dividendSchema>;

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dividend Tracker</h2>
          <p className="text-slate-400 text-sm mt-1">Track dividend income from your stock holdings.</p>
        </div>
        {isAdmin && !showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors">
            <Plus className="w-4 h-4" /> Log Dividend
          </button>
        )}
      </div>

      {/* Stat Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center gap-4">
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800"><DollarSign className="text-amber-500" /></div>
          <div>
            <p className="text-sm font-medium text-slate-400">Total Dividends Received</p>
            <p className="text-xl font-bold tracking-tight text-slate-100">Rp{totalDividends.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-0.5">{dividends.length} dividend entries</p>
          </div>
        </div>
        {upcomingCumDates.length > 0 && (
          <div className="bg-slate-900 border border-amber-500/20 p-5 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-5 h-5 text-amber-500" />
              <h3 className="font-medium text-amber-400 text-sm">Upcoming Cum Dates</h3>
            </div>
            <ul className="space-y-1.5">
              {upcomingCumDates.slice(0, 5).map(d => (
                <li key={d.id} className="text-xs text-slate-300 flex justify-between">
                  <span className="font-medium">{d.emiten}</span>
                  <span className="text-slate-400">{format(parseISO(d.tanggal_cum_date), 'dd MMM yyyy')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="font-medium text-slate-200">New Dividend Entry</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Emiten</label>
              <input {...register('emiten')} placeholder="e.g. BBRI" list="div-emitens" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none uppercase" />
              <datalist id="div-emitens">{existingEmitens.map(e => <option key={e} value={e} />)}</datalist>
              {errors.emiten && <span className="text-xs text-red-500">{errors.emiten.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Cum Date</label>
              <input type="date" {...register('tanggal_cum_date')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Payment Date</label>
              <input type="date" {...register('tanggal_pembayaran')} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Total Shares</label>
              <input type="number" step="1" {...register('jumlah_lembar', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
              {errors.jumlah_lembar && <span className="text-xs text-red-500">{errors.jumlah_lembar.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Dividend per Share (Rp)</label>
              <input type="number" step="0.01" {...register('dividend_per_lembar', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
              {errors.dividend_per_lembar && <span className="text-xs text-red-500">{errors.dividend_per_lembar.message}</span>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Tax (Rp)</label>
              <input type="number" step="1" {...register('pajak', { valueAsNumber: true })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => { setShowForm(false); reset(); }} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-50">
              {isSubmitting ? 'Saving...' : 'Add Dividend'}
            </button>
          </div>
        </form>
      )}

      {/* Dividend History */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950/50">
            <tr>
              <th className="px-4 py-3">Emiten</th>
              <th className="px-4 py-3">Cum Date</th>
              <th className="px-4 py-3">Payment Date</th>
              <th className="px-4 py-3">Shares</th>
              <th className="px-4 py-3">Div/Share</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">Tax</th>
              <th className="px-4 py-3 text-right">Net Dividend</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dividends.map(d => (
              <tr key={d.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                <td className="px-4 py-3 font-medium text-slate-200">{d.emiten}</td>
                <td className="px-4 py-3 text-slate-300">{format(parseISO(d.tanggal_cum_date), 'dd MMM yyyy')}</td>
                <td className="px-4 py-3 text-slate-300">{format(parseISO(d.tanggal_pembayaran), 'dd MMM yyyy')}</td>
                <td className="px-4 py-3 text-slate-300">{d.jumlah_lembar.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-300">Rp{d.dividend_per_lembar.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-300">Rp{d.total_dividend.toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-400">{d.pajak > 0 ? `Rp${d.pajak.toLocaleString()}` : '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-emerald-400">Rp{d.net_dividend.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  {isAdmin && (
                    <button onClick={() => handleDelete(d.id)} disabled={deletingId === d.id} className="text-slate-400 hover:text-rose-400 disabled:opacity-50" title="Delete dividend">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {dividends.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No dividend entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
