import { useState, useMemo } from 'react';
import { useCryptoData } from '../../hooks/useCryptoData';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { RefreshCw, X } from 'lucide-react';
import { useCryptoPolling, useCryptoPriceMap, useCryptoFeedMeta, refreshCrypto } from '../../state/prices';
import { resolvePrice, futuresUnrealized } from '../../lib/cryptoLivePnl';
import { useAuth } from '../../contexts/AuthProvider';
import { normalizeCashFlowTipe } from '../../lib/balanceCalc';
import { PageHeader } from '../../components/adm/PageHeader';
import { StatusBadge } from '../../components/adm/StatusBadge';
import { DataTable, type Column } from '../../components/adm/DataTable';
import { HScrollTable } from '../../components/HScrollTable';
import { fmtUsd, fmtSignedUsd, fmtCryptoPrice } from '../../design/format';
import type { CryptoFuturesTrade } from '../../types';

async function recalculateCryptoBalances(overridePnl?: { tradeId: string; pnlValue: number }) {
  const { data: allTrades, error: tradesError } = await supabase
    .from('crypto_futures_trades')
    .select('*')
    .order('tanggal', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: cashFlows, error: cashFlowsError } = await supabase
    .from('cash_flows')
    .select('*')
    .eq('desk', 'Crypto')
    .order('tanggal', { ascending: true });

  // maybeSingle: a missing settings row (fresh migrated DB) must not hard-fail
  // the whole close/delete — we fall back to modal_awal_crypto = 0.
  const { data: settings, error: settingsError } = await supabase
    .from('account_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  const readError = tradesError || cashFlowsError || settingsError;
  if (readError) {
    throw new Error(`Could not load data to recalculate Crypto account balances. Balances were not updated — refresh the Journal and try again. (${readError.message})`);
  }
  if (!allTrades) return;

  let currentBalance: number = Number(settings?.modal_awal_crypto ?? 0);

  type Event = { type: 'trade'; date: number; createdAt: string; data: typeof allTrades[0] }
             | { type: 'cashflow'; date: number; createdAt: string; data: NonNullable<typeof cashFlows>[0] };

  const events: Event[] = [];
  allTrades.forEach(t => events.push({ type: 'trade', date: new Date(t.tanggal).getTime(), createdAt: t.created_at, data: t }));
  cashFlows?.forEach(cf => events.push({ type: 'cashflow', date: new Date(cf.tanggal).getTime(), createdAt: cf.created_at, data: cf }));
  events.sort((a, b) => a.date - b.date || a.createdAt.localeCompare(b.createdAt));

  const updates: { id: string; net_pnl: number; saldo_akun: number; persen_profit_loss: number; status: string }[] = [];

  for (const ev of events) {
    if (ev.type === 'cashflow') {
      const cf = ev.data;
      const tipe = normalizeCashFlowTipe(cf);
      if (tipe === 'Deposit' || tipe === 'Transfer Masuk') currentBalance += Number(cf.jumlah);
      else if (tipe === 'Withdraw' || tipe === 'Transfer Keluar') currentBalance -= Number(cf.jumlah);
    } else {
      const t = ev.data;
      let pnl: number | null = t.net_pnl;
      let newStatus = t.status;
      if (overridePnl && t.id === overridePnl.tradeId) {
        pnl = overridePnl.pnlValue;
        newStatus = 'Closed';
      }
      if (newStatus === 'Closed' && pnl !== null && pnl !== undefined) {
        const prevBalance = currentBalance;
        currentBalance += Number(pnl);
        const pct = prevBalance !== 0 ? (Number(pnl) / prevBalance) * 100 : 0;
        updates.push({ id: t.id, net_pnl: Number(pnl), saldo_akun: currentBalance, persen_profit_loss: pct, status: 'Closed' });
      }
    }
  }

  // Stop on the first failure: this re-derives every closed trade's balance from scratch,
  // so a partial run is fully fixed by re-running.
  let done = 0;
  for (const update of updates) {
    const { error: updateError } = await supabase.from('crypto_futures_trades').update({
      net_pnl: update.net_pnl, saldo_akun: update.saldo_akun, persen_profit_loss: update.persen_profit_loss, status: update.status,
    }).eq('id', update.id);
    if (updateError) {
      throw new Error(`Crypto balance recalculation failed after updating ${done} of ${updates.length} trade(s) (failed on trade ${update.id}). Balances are partially updated — refresh the Journal to recompute, or retry. (${updateError.message})`);
    }
    done++;
  }
}

const inputCls = 'w-full rounded-adm-sm border border-adm-line bg-adm-bg0 px-3 py-2 font-adm-data text-adm-sm text-adm-ink-hi placeholder:text-adm-ink-dim focus:border-adm-line2 focus:outline-none';
const labelCls = 'mb-1 block font-adm-data text-adm-micro uppercase text-adm-ink-dim';

/* Per-row live cells — subscribe to the crypto price map, so a tick re-renders
 * only the mark/uPnL of open positions. Raw swap, no animation. */
function LiveMark({ trade }: { trade: CryptoFuturesTrade }) {
  const prices = useCryptoPriceMap();
  if (trade.status !== 'Open') return <span className="text-adm-ink-dim">—</span>;
  const p = resolvePrice(prices, trade.coin);
  return p != null ? <span className="text-adm-ink-hi">{fmtCryptoPrice(p)}</span> : <span className="text-adm-ink-dim">—</span>;
}
function LiveUPnl({ trade }: { trade: CryptoFuturesTrade }) {
  const prices = useCryptoPriceMap();
  if (trade.status !== 'Open') return <span className="text-adm-ink-dim">—</span>;
  const p = resolvePrice(prices, trade.coin);
  if (p == null) return <span className="text-adm-ink-dim">—</span>;
  const u = futuresUnrealized(trade, p);
  return <span className={u < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(u)}</span>;
}

export function FuturesJournal() {
  useCryptoPolling();
  const { futuresTrades, loading, error: fetchError, refetch } = useCryptoData();
  const feed = useCryptoFeedMeta();
  const { isAdmin } = useAuth();
  const [filterCoin, setFilterCoin] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'Open' | 'Closed'>('');
  const [closingTrade, setClosingTrade] = useState<CryptoFuturesTrade | null>(null);
  const [closePnl, setClosePnl] = useState('');
  const [closeFunding, setCloseFunding] = useState('');
  const [closeExit, setCloseExit] = useState('');
  const [closeDate, setCloseDate] = useState(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);

  const resetClose = () => { setClosingTrade(null); setClosePnl(''); setCloseFunding(''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); };

  const coins = useMemo(() => Array.from(new Set(futuresTrades.map(t => t.coin))), [futuresTrades]);

  const filtered = useMemo(() => {
    let result = futuresTrades;
    if (filterCoin) result = result.filter(t => t.coin === filterCoin);
    if (filterStatus) result = result.filter(t => t.status === filterStatus);
    return result.slice().reverse();
  }, [futuresTrades, filterCoin, filterStatus]);

  const handleClose = async (tradeId: string) => {
    const grossPnl = parseFloat(closePnl);
    if (isNaN(grossPnl)) { alert('Enter a valid PnL'); return; }
    const exitVal = closeExit.trim() === '' ? null : parseFloat(closeExit);
    if (closeExit.trim() !== '' && (exitVal == null || isNaN(exitVal) || exitVal <= 0)) { alert('Exit price must be a positive number (or left blank)'); return; }
    const closeDateVal = closeDate || new Date().toISOString().split('T')[0];
    setIsProcessing(true);
    try {
      const fundingValue = parseFloat(closeFunding) || 0;
      const finalNetPnl = grossPnl - fundingValue;

      // Save funding fee + exit metadata (harga_exit, tanggal_tutup) in one update.
      // net_pnl/status/saldo are set by the replay below.
      const metaUpdate: Record<string, unknown> = { harga_exit: exitVal, tanggal_tutup: closeDateVal };
      if (!isNaN(parseFloat(closeFunding)) && closeFunding.trim() !== '') metaUpdate.funding_rate_paid = fundingValue;
      const { error: metaError } = await supabase.from('crypto_futures_trades').update(metaUpdate).eq('id', tradeId);
      if (metaError) throw new Error(`Failed to save the close details for this position; balances were not recalculated. Refresh and try again. (${metaError.message})`);

      await recalculateCryptoBalances({ tradeId, pnlValue: finalNetPnl });
      resetClose();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteFutures = async (tradeId: string) => {
    if (!window.confirm('Delete this futures position? This cannot be undone. Crypto balances will be recalculated.')) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('crypto_futures_trades').delete().eq('id', tradeId);
      if (error) throw error;
      // Replay re-derives saldo_akun for the remaining closed positions from scratch.
      await recalculateCryptoBalances();
      refetch();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const isEdit = closingTrade?.status === 'Closed';

  const columns: Column<CryptoFuturesTrade>[] = [
    // Dates aligned to the full "DD MMM YYYY" / 124px treatment used on the Forex
    // journal so no desk shows a truncated or ambiguous 2-digit year.
    { key: 'tanggal', header: 'Date', width: '124px', sortValue: t => t.tanggal, cell: t => <span className="font-adm-data text-adm-ink-mid">{format(parseISO(t.tanggal), 'dd MMM yyyy')}</span> },
    // 112px: longest Binance base symbol ("1000000BONK") measures 103px incl. padding.
    { key: 'coin', header: 'Coin', width: '112px', cell: t => <span className="font-adm-data text-adm-ink-hi">{t.coin}</span> },
    { key: 'posisi', header: 'Side', width: '76px', cell: t => <StatusBadge kind={t.posisi === 'Long' ? 'long' : 'short'} label={t.posisi.toUpperCase()} /> },
    // 136px fits a 7–8-figure notional; live-measured "$10,000,000.00" = 134px.
    { key: 'notional_usd', header: 'Notional', numeric: true, width: '136px', sortValue: t => t.notional_usd, cell: t => fmtUsd(t.notional_usd) },
    { key: 'leverage', header: 'Lev', numeric: true, width: '60px', cell: t => `${t.leverage}x` },
    // Adaptive crypto precision: BTC 2 dp, sub-cent coins up to 8 dp; live worst 102px.
    { key: 'harga_entry', header: 'Entry', numeric: true, width: '104px', cell: t => fmtCryptoPrice(t.harga_entry) },
    { key: 'harga_exit', header: 'Exit', numeric: true, width: '104px', cell: t => (t.harga_exit != null ? fmtCryptoPrice(t.harga_exit) : <span className="text-adm-ink-dim">—</span>) },
    { key: 'mark', header: 'Mark', numeric: true, width: '104px', sortValue: () => null, cell: t => <LiveMark trade={t} /> },
    { key: 'status', header: 'Status', width: '84px', cell: t => <StatusBadge kind={t.status === 'Open' ? 'open' : 'closed'} /> },
    { key: 'tanggal_tutup', header: 'Closed', width: '124px', sortValue: t => t.tanggal_tutup ?? null, cell: t => <span className="font-adm-data text-adm-ink-mid">{t.tanggal_tutup ? format(parseISO(t.tanggal_tutup), 'dd MMM yyyy') : '—'}</span> },
    // 136px: live-measured "−$1,234,567.89" = 134px; header "UNRLZD P&L" 94px.
    { key: 'upnl', header: 'Unrlzd P&L', numeric: true, width: '136px', sortValue: () => null, cell: t => <LiveUPnl trade={t} /> },
    {
      key: 'net_pnl', header: 'Net P&L', numeric: true, width: '120px', sortValue: t => t.net_pnl ?? null,
      cell: t => t.net_pnl == null ? <span className="text-adm-ink-dim">—</span> : <span className={t.net_pnl > 0 ? 'text-adm-up' : t.net_pnl < 0 ? 'text-adm-down' : 'text-adm-ink-mid'}>{fmtSignedUsd(t.net_pnl)}</span>,
    },
    { key: 'persen_profit_loss', header: 'Gain %', numeric: true, width: '96px', sortValue: t => t.persen_profit_loss ?? null, cell: t => (t.persen_profit_loss != null ? `${t.persen_profit_loss.toFixed(2)}%` : '—') },
    {
      key: 'actions', header: '', width: '120px', align: 'right',
      cell: t => isAdmin ? (
        <span className="flex items-center justify-end gap-1">
          {t.status === 'Open' && (
            <button onClick={() => { setClosingTrade(t); setClosePnl(''); setCloseFunding(t.funding_rate_paid?.toString() || ''); setCloseExit(''); setCloseDate(new Date().toISOString().split('T')[0]); }} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-desk-crypto hover:bg-adm-bg2" title="Close position">Close</button>
          )}
          {t.status === 'Closed' && (
            <button onClick={() => { setClosingTrade(t); setClosePnl(t.net_pnl?.toString() || ''); setCloseFunding(t.funding_rate_paid?.toString() || ''); setCloseExit(t.harga_exit?.toString() || ''); setCloseDate(t.tanggal_tutup || new Date().toISOString().split('T')[0]); }} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2" title="Edit PnL / exit">Edit</button>
          )}
          <button onClick={() => handleDeleteFutures(t.id)} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-down hover:bg-adm-bg2 disabled:opacity-40" title="Delete position">Del</button>
        </span>
      ) : null,
    },
  ];

  if (loading) return <div className="flex h-64 items-center justify-center font-adm-data text-adm-sm text-adm-ink-dim">Loading journal…</div>;

  const feedSecs = feed.lastUpdated != null ? Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000)) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        desk="crypto"
        title="Futures Journal"
        sub="perpetuals · live unrealized P&L"
        right={
          <div className="flex items-center gap-2">
            <StatusBadge kind={feed.status} detail={feed.status === 'live' && feedSecs != null ? `${feedSecs}s ago` : undefined} title="Binance feed" />
            <button onClick={refreshCrypto} title="Refresh prices" aria-label="Refresh prices" className="flex items-center justify-center rounded-adm-sm border border-adm-line p-1 text-adm-ink-mid hover:bg-adm-bg2">
              <RefreshCw className={cn('h-3.5 w-3.5', feed.status === 'loading' && 'animate-spin')} />
            </button>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as '' | 'Open' | 'Closed')} className="rounded-adm-sm border border-adm-line bg-adm-bg1 px-2 py-1 font-adm-data text-adm-xs text-adm-ink-mid focus:border-adm-line2 focus:outline-none">
              <option value="">All status</option>
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
            <select value={filterCoin} onChange={e => setFilterCoin(e.target.value)} className="rounded-adm-sm border border-adm-line bg-adm-bg1 px-2 py-1 font-adm-data text-adm-xs text-adm-ink-mid focus:border-adm-line2 focus:outline-none">
              <option value="">All coins</option>
              {coins.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        }
      />

      {fetchError && (
        <p className="rounded-adm border border-adm-down/40 bg-adm-down-fill px-3 py-2 font-adm-data text-adm-xs text-adm-down">
          Failed to load journal data: {fetchError} — the list below may be stale.{' '}
          <button onClick={() => refetch()} className="underline hover:text-adm-ink-hi">Retry</button>
        </p>
      )}

      {/* Same treatment as the Forex journal: sticky h-scroll wrapper, no cell
          truncation, 42px rows, 10/page. minWidth is the sum of the re-measured
          column tracks (1460px). */}
      <HScrollTable>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={t => t.id}
          minWidth={1500}
          noTruncate
          hScroll={false}
          pageSize={10}
          virtualizeOver={Infinity}
          rowHeight={42}
          empty="No futures trades found."
        />
      </HScrollTable>

      {/* Close / edit drawer — same fields + mutation path as the old inline form. */}
      {closingTrade && (
        <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(10,12,14,0.85)]" onClick={() => !isProcessing && resetClose()}>
          <div className="h-full w-full max-w-sm overflow-y-auto border-l border-adm-line2 bg-adm-bg1 p-5" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{isEdit ? 'Edit closed futures' : 'Close position'}</p>
                <h3 className="font-adm-ui text-adm-lg font-medium text-adm-ink-hi">{closingTrade.coin} · {closingTrade.posisi}</h3>
              </div>
              <button onClick={resetClose} className="text-adm-ink-dim hover:text-adm-ink-hi" title="Cancel" aria-label="Cancel"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Gross P&L (USD)</label>
                <input type="number" value={closePnl} onChange={e => setClosePnl(e.target.value)} className={inputCls} placeholder="e.g. 120.50 or -45" autoFocus />
              </div>
              <div>
                <label className={labelCls}>Funding fee (USD)</label>
                <input type="number" value={closeFunding} onChange={e => setCloseFunding(e.target.value)} className={inputCls} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Exit price (optional)</label>
                <input type="number" value={closeExit} onChange={e => setCloseExit(e.target.value)} className={inputCls} placeholder="Leave blank to skip" />
              </div>
              <div>
                <label className={labelCls}>Close date</label>
                <input type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} className={inputCls} />
              </div>
              <p className="font-adm-data text-adm-micro text-adm-ink-dim">Net P&L = gross − funding fee. Balances replay on save.</p>
              <div className="flex gap-2 pt-1">
                <button onClick={() => handleClose(closingTrade.id)} disabled={isProcessing} className="flex-1 rounded-adm-sm border border-adm-line2 bg-adm-bg2 px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-hi hover:border-adm-desk-crypto disabled:opacity-40">
                  {isProcessing ? 'Saving…' : isEdit ? 'Save changes' : 'Confirm close'}
                </button>
                <button onClick={resetClose} disabled={isProcessing} className="rounded-adm-sm border border-adm-line px-4 py-2 font-adm-data text-adm-xs uppercase text-adm-ink-mid hover:bg-adm-bg2">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
