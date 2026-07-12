import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { useEquitiesData } from '../../hooks/useEquitiesData';
import { supabase } from '../../lib/supabase';
import { recalculateHolding } from '../../lib/stockCalc';
import { useAuth } from '../../contexts/AuthProvider';
import { getCurrencyForDesk } from '../../types';
import { PageHeader } from '../../components/adm/PageHeader';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { HScrollTable } from '../../components/HScrollTable';
import { fmtIdr } from '../../design/format';

type Tx = ReturnType<typeof useEquitiesData>['transactions'][number];

const selectCls = 'rounded-adm-sm border border-adm-line bg-adm-bg1 px-2 py-1 font-adm-data text-adm-micro uppercase text-adm-ink-mid outline-none focus:border-adm-line2';

export function StockHistory() {
  const { transactions, loading, error: fetchError, refetch } = useEquitiesData();
  const { isAdmin } = useAuth();
  const [filterEmiten, setFilterEmiten] = useState('');
  const [filterTipe, setFilterTipe] = useState<'' | 'Buy' | 'Sell'>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (tx: Tx) => {
    if (!window.confirm(`Delete this ${tx.tipe} transaction for ${tx.emiten}? This reverses its cash flow and recalculates the holding. This cannot be undone.`)) return;
    setDeletingId(tx.id);
    try {
      const grossValue = tx.lot * 100 * tx.harga;
      const komisi = tx.komisi || 0;
      // Reverse the linked Trading cash flow: a Buy was a Withdraw (cost + komisi),
      // a Sell was a Deposit (proceeds − komisi). Both hit the Trading account.
      const reversal = tx.tipe === 'Buy'
        ? { tipe: 'Deposit' as const, jumlah: grossValue + komisi }
        : { tipe: 'Withdraw' as const, jumlah: grossValue - komisi };

      // Step 1 (recoverable first): record the offsetting cash flow. If it fails, the
      // transaction is never touched.
      const { data: cf, error: cfError } = await supabase.from('cash_flows').insert({
        tanggal: tx.tanggal,
        tipe: reversal.tipe,
        jumlah: reversal.jumlah,
        desk: 'Saham',
        currency: getCurrencyForDesk('Saham'),
        account_type: 'Trading',
        is_reversal: true,
        catatan: `Reversal: deleted ${tx.tipe} ${tx.lot} lot ${tx.emiten} @ ${tx.harga.toLocaleString()}`,
      }).select('id').single();
      if (cfError) throw new Error(`Could not record the reversal cash flow. The transaction was NOT deleted. Please try again. (${cfError.message})`);

      // Step 2: delete the transaction. If it fails, roll back the reversal we just added.
      const { error: delError } = await supabase.from('stock_transactions').delete().eq('id', tx.id);
      if (delError) {
        const { error: rbError } = await supabase.from('cash_flows').delete().eq('id', cf.id);
        if (rbError) {
          throw new Error(`The transaction could not be deleted AND the reversal cash flow could not be rolled back. Please manually delete the reversal cash_flows row for ${tx.emiten} to keep your Trading balance correct. (${delError.message})`);
        }
        throw new Error(`Could not delete the transaction; the reversal was rolled back, so nothing changed. Please try again. (${delError.message})`);
      }

      // Step 3: recalculate the derived holding LAST (idempotent — replays remaining
      // transactions). If it throws, the transaction + reversal are already consistent and
      // only the holdings summary is stale; the thrown message explains how to recompute.
      await recalculateHolding(tx.emiten);
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const emitens = useMemo(() => Array.from(new Set(transactions.map(t => t.emiten))).sort(), [transactions]);

  const filtered = useMemo(() => {
    let result = transactions;
    if (filterEmiten) result = result.filter(t => t.emiten === filterEmiten);
    if (filterTipe) result = result.filter(t => t.tipe === filterTipe);
    return result;
  }, [transactions, filterEmiten, filterTipe]);

  const columns: Column<Tx>[] = [
    // Date aligned to the full "DD MMM YYYY" / 124px treatment shared with the other desks.
    { key: 'tanggal', header: 'Date', width: '124px', sortValue: t => Date.parse(t.tanggal), cell: t => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(t.tanggal), 'dd MMM yyyy')}</span> },
    { key: 'emiten', header: 'Emiten', width: 'minmax(72px,1fr)', cell: t => <span className="text-adm-ink-hi">{t.emiten}</span> },
    { key: 'tipe', header: 'Type', width: '70px', cell: t => <span className={t.tipe === 'Buy' ? 'text-adm-up' : 'text-adm-down'}>{t.tipe}</span> },
    // Widths from live IBM Plex Mono measurement of realistic IDR upper bounds:
    // lot up to 7 digits (79px); share price up to "Rp10,000,000" (118px); per-row
    // value up to "Rp100,000,000,000" (157px); commission up to "Rp10,000,000" (118px).
    { key: 'lot', header: 'Lot', numeric: true, width: '80px', sortValue: t => t.lot, cell: t => String(t.lot) },
    { key: 'harga', header: 'Price', numeric: true, width: '120px', sortValue: t => t.harga, cell: t => fmtIdr(t.harga) },
    { key: 'value', header: 'Value', numeric: true, width: '160px', sortValue: t => t.lot * 100 * t.harga, cell: t => fmtIdr(t.lot * 100 * t.harga) },
    { key: 'komisi', header: 'Comm', numeric: true, width: '120px', sortValue: t => t.komisi || 0, cell: t => t.komisi > 0 ? fmtIdr(t.komisi) : <span className="text-adm-ink-dim">—</span> },
    { key: 'tag', header: 'Tag', width: 'minmax(90px,1fr)', sortValue: t => t.analysis_tag_obj?.name ?? '', cell: t => t.analysis_tag_obj ? <span className="text-adm-desk-saham">{t.analysis_tag_obj.name}</span> : <span className="text-adm-ink-dim">—</span> },
    // Free-text notes: under noTruncate the old inner `truncate`+title would never
    // clip, so wrap to 2 lines (the Setup·Psych treatment) with a 160px floor.
    { key: 'catatan', header: 'Notes', width: 'minmax(160px,1.4fr)', wrap: true, cell: t => t.catatan ? <span className="font-adm-ui text-adm-xs text-adm-ink-mid">{t.catatan}</span> : <span className="text-adm-ink-dim">—</span> },
    ...(isAdmin ? [{
      key: 'actions', header: '', width: '48px', align: 'right' as const,
      cell: (t: Tx) => (
        <button onClick={() => handleDelete(t)} disabled={deletingId === t.id} className="text-adm-ink-dim hover:text-adm-down disabled:opacity-50" title="Delete transaction" aria-label="Delete transaction">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ),
    }] : []),
  ];

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading history…</div>;

  return (
    <div className="space-y-4">
      {fetchError && (
        <div className="rounded-adm border border-adm-down/50 bg-adm-down-fill px-4 py-3 font-adm-data text-adm-xs text-adm-down">
          Failed to load transaction data: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-adm-ink-hi">Retry</button>
        </div>
      )}
      <PageHeader
        desk="saham"
        title="Transaction History"
        sub="full audit trail of stock buys & sells"
        right={
          <div className="flex items-center gap-2">
            <select value={filterTipe} onChange={e => setFilterTipe(e.target.value as '' | 'Buy' | 'Sell')} className={selectCls}>
              <option value="">All Types</option>
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
            <select value={filterEmiten} onChange={e => setFilterEmiten(e.target.value)} className={selectCls}>
              <option value="">All Emiten</option>
              {emitens.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        }
      />

      {/* Same treatment as the Forex journal: sticky h-scroll wrapper, no cell
          truncation, 42px rows, 10/page. */}
      <HScrollTable>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={t => t.id}
          defaultSort={{ key: 'tanggal', dir: 'desc' }}
          minWidth={1120}
          noTruncate
          hScroll={false}
          pageSize={10}
          rowHeight={42}
          empty="No transactions found."
        />
      </HScrollTable>
    </div>
  );
}
