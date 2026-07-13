/**
 * Combined (cross-desk) equity curve — reconstructs a unified USD equity-over-time
 * series from the per-desk closed-trade `saldo_akun` snapshots that already back
 * each desk's own equity curve. No new persistence, snapshots, or cron needed:
 * the running balance is replayed from history that Supabase already stores.
 *
 * Contract with the per-desk dashboards (so the Overview can never drift):
 *  - One point per WIB close-day, LAST write wins — identical bucketing to
 *    Dashboard.tsx's forex curve (wibDayKey over tanggal_tutup || tanggal).
 *  - Balances are taken verbatim from `saldo_akun`; the only transform is the
 *    desk's native→USD conversion (identity for Forex/Crypto, ÷rate for IDR).
 *  - Desks with no `saldo_akun` history (e.g. Saham today, or any desk with zero
 *    closed trades) contribute an EMPTY series — never an estimated value.
 */

const WIB_TZ = 'Asia/Jakarta';
/** YYYY-MM-DD in WIB — matches Dashboard.tsx's wibDayKey exactly. */
function wibDayKey(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-CA', { timeZone: WIB_TZ });
}

export type EquityPoint = { ts: number; equityUsd: number };

type ClosedBalanceRow = {
  saldo_akun?: number | null;
  tanggal: string;
  tanggal_tutup?: string;
};

/**
 * Build one desk's USD equity series from its closed trades. Rows without a
 * `saldo_akun` are skipped (as in the per-desk curves). `toUsd` normalizes the
 * native balance to USD — pass the identity for USD/USDT desks, or a divide-by-
 * rate for IDR desks. Returns points sorted ascending by timestamp.
 */
export function deskEquitySeries<T extends ClosedBalanceRow>(
  closedTrades: T[],
  toUsd: (nativeBalance: number) => number,
): EquityPoint[] {
  const byDay = new Map<string, EquityPoint>();
  for (const t of closedTrades) {
    if (t.saldo_akun == null) continue;
    const day = wibDayKey(t.tanggal_tutup || t.tanggal);
    byDay.set(day, { ts: Math.floor(Date.parse(day) / 1000), equityUsd: toUsd(t.saldo_akun) });
  }
  return Array.from(byDay.values()).sort((a, b) => a.ts - b.ts);
}

/**
 * Merge per-desk series into one combined USD curve. At every timestamp where
 * ANY desk has a point, the combined value is the sum of each desk's latest
 * known equity at-or-before that timestamp (standard forward-fill / carry-
 * forward). A desk contributes 0 before its first point — i.e. an inactive or
 * zero-trade desk adds nothing, so the curve renders correctly on Forex alone.
 * Returns uPlot-ready parallel arrays (x = unix seconds, y = USD).
 */
export function combinedEquityCurve(deskSeries: EquityPoint[][]): { x: number[]; y: number[] } {
  const allTs = Array.from(new Set(deskSeries.flatMap(s => s.map(p => p.ts)))).sort((a, b) => a - b);
  if (allTs.length === 0) return { x: [], y: [] };

  const cursor = deskSeries.map(() => 0);   // next unconsumed index per desk
  const carried = deskSeries.map(() => 0);  // last known equity per desk (0 = pre-first-trade)
  const y: number[] = [];

  for (const ts of allTs) {
    let sum = 0;
    deskSeries.forEach((series, i) => {
      while (cursor[i] < series.length && series[cursor[i]].ts <= ts) {
        carried[i] = series[cursor[i]].equityUsd;
        cursor[i] += 1;
      }
      sum += carried[i];
    });
    y.push(sum);
  }
  return { x: allTs, y };
}
