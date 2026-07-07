import { useMemo } from 'react';
import { usePublicData } from '../../../hooks/usePublicData';
import { useFxRate } from '../../../contexts/FxRateProvider';
import { useForexPrices } from '../../../contexts/ForexPriceProvider';
import { useReducedMotion } from './goldHooks';
import { HeroGold } from './HeroGold';
import { AllocationGold, type AllocSlice } from './AllocationGold';
import { EquityCurveGold, type CurvePoint } from './EquityCurveGold';
import { TrackRecordGold, type TrackRow } from './TrackRecordGold';
import { FooterGold } from './FooterGold';

/*
 * GoldLanding — the ONLY data-aware piece of the gold public design.
 * It pulls from usePublicData (curated public_* views) + useFxRate + useForexPrices,
 * derives display values, and passes them as props to presentational sections.
 * Swapping the public design later = replace these section components, reuse this wiring.
 */

const fmtPrice = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 5 : 2 });

// Bucket a stored (UTC) timestamp/date by the user's LOCAL (WIB) calendar day. Intl-based —
// no hardcoded +7 offset. `en-CA` yields YYYY-MM-DD, which also sorts chronologically.
const WIB_TZ = 'Asia/Jakarta';
const wibDayKey = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-CA', { timeZone: WIB_TZ });

export function GoldLanding() {
  const pub = usePublicData();
  const { usdIdrRate } = useFxRate();
  const { prices, lastUpdated: xauUpdated } = useForexPrices();
  const reduced = useReducedMotion();

  const model = useMemo(() => {
    const row = (d: string) => pub.aggregates.find(a => a.desk === d);
    const fx = row('Forex'), cr = row('Crypto'), sh = row('Saham');

    const forexEq = fx?.equity ?? 0;
    const cryptoEq = cr?.equity ?? 0;
    const sahamEqUsd = (sh?.equity ?? 0) / usdIdrRate;
    const totalAum = forexEq + cryptoEq + sahamEqUsd;

    const totalModal = (fx?.modal_awal ?? 0) + (cr?.modal_awal ?? 0) + (sh?.modal_awal ?? 0) / usdIdrRate;
    const totalPnl = (fx?.pnl ?? 0) + (cr?.pnl ?? 0) + (sh?.pnl ?? 0) / usdIdrRate;
    const returnPct = totalModal !== 0 ? (totalPnl / totalModal) * 100 : 0;

    const pct = (v: number) => (totalAum > 0 ? Math.round((v / totalAum) * 100) : 0);
    const slices: AllocSlice[] = [
      { desk: 'Forex, Commodities & Indices', equityUsd: forexEq, pct: pct(forexEq), color: '#E8D199', desc: 'Majors, indices & XAUUSD' },
      { desk: 'Crypto', equityUsd: cryptoEq, pct: pct(cryptoEq), color: '#7F95A8', desc: 'Spot & perpetual futures' },
      { desk: 'Stock Market', equityUsd: sahamEqUsd, pct: pct(sahamEqUsd), color: '#7FB89A', desc: 'Indonesian blue-chips' },
    ];

    // Win rate — from closed positions that carry a realized P&L.
    const closedPnls = [
      ...pub.forexClosed.map(t => t.net_pnl),
      ...pub.cryptoFuturesClosed.map(t => t.realized_pnl),
      ...pub.spotSales.map(s => s.realized_pnl),
    ].filter((v): v is number => v != null);
    const wins = closedPnls.filter(v => v > 0).length;
    const winRate = closedPnls.length ? (wins / closedPnls.length) * 100 : 0;

    const openCount =
      pub.forexOpen.length + pub.cryptoFuturesOpen.length + pub.spotHoldings.length + pub.stockHoldings.length;

    // Cumulative realized P&L curve (USD) across ALL desks (Forex + Crypto + Saham) from closed
    // positions. Aggregated to ONE point per WIB trading day = cumulative P&L as of the END of
    // that day, so multiple positions closed on the same calendar day collapse to a single point
    // (no per-trade spikes). Time-range filters downstream operate on this day-bucketed series.
    const events = [
      ...pub.forexClosed.map(t => ({ date: t.tanggal_tutup ?? t.tanggal_buka, pnl: t.net_pnl ?? 0 })),
      ...pub.cryptoFuturesClosed.map(t => ({ date: t.tanggal_tutup ?? t.tanggal_buka, pnl: t.realized_pnl ?? 0 })),
      ...pub.spotSales.map(s => ({ date: s.tanggal, pnl: s.realized_pnl ?? 0 })),
    ].filter((e): e is { date: string; pnl: number } => !!e.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Accumulate chronologically; the LAST write per WIB day wins = end-of-day cumulative value.
    let run = 0;
    const byDay = new Map<string, number>();
    for (const e of events) {
      run += e.pnl;
      byDay.set(wibDayKey(e.date), run);
    }
    const series: CurvePoint[] = Array.from(byDay, ([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Track record — merge closed views, tagged by asset category, newest first.
    // No global cap here: the section-03 component caps per filtered view.
    const rows: TrackRow[] = [
      ...pub.forexClosed.map((t): TrackRow => ({
        inst: t.instrument, desk: 'Forex, Commodities & Indices', side: t.direction === 'Sell' ? 'SHORT' : 'LONG',
        entry: fmtPrice(t.harga_entry), exit: t.harga_exit != null ? fmtPrice(t.harga_exit) : '—',
        pnl: t.net_pnl ?? null, date: (t.tanggal_tutup ?? t.tanggal_buka) ?? '', category: 'forex',
      })),
      ...pub.cryptoFuturesClosed.map((t): TrackRow => ({
        inst: t.coin, desk: 'Crypto', side: t.direction === 'Short' ? 'SHORT' : 'LONG',
        entry: fmtPrice(t.harga_entry), exit: t.harga_exit != null ? fmtPrice(t.harga_exit) : '—',
        pnl: t.realized_pnl ?? null, date: (t.tanggal_tutup ?? t.tanggal_buka) ?? '', category: 'crypto',
      })),
      ...pub.spotSales.map((s): TrackRow => ({
        inst: s.coin, desk: 'Crypto', side: 'SELL',
        entry: fmtPrice(s.harga_beli_rata_at_sell), exit: fmtPrice(s.harga_jual),
        pnl: s.realized_pnl ?? null, date: s.tanggal, category: 'crypto',
      })),
      ...pub.stockSells.map((s): TrackRow => ({
        inst: s.ticker, desk: 'Stock Market', side: 'SELL',
        entry: '—', exit: fmtPrice(s.harga), pnl: null, date: s.tanggal, category: 'stock',
      })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return { totalAum, returnPct, winRate, openCount, slices, series, rows };
  }, [pub, usdIdrRate]);

  const xau = prices.get('XAUUSD') ?? null;

  if (pub.loading) {
    return <div className="min-h-dvh bg-ink text-bone-dim flex items-center justify-center font-data text-sm">Loading live portfolio…</div>;
  }

  return (
    <div className="min-h-dvh bg-ink font-grotesk text-bone antialiased">
      <HeroGold
        aum={model.totalAum} returnPct={model.returnPct} winRate={model.winRate}
        openCount={model.openCount} xau={xau} xauUpdated={xauUpdated} reduced={reduced}
      />
      <main>
        <AllocationGold slices={model.slices} totalAum={model.totalAum} reduced={reduced} />
        <EquityCurveGold series={model.series} totalAum={model.totalAum} returnPct={model.returnPct} reduced={reduced} />
        <TrackRecordGold rows={model.rows} reduced={reduced} />
      </main>
      <FooterGold />
    </div>
  );
}
