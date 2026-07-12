/**
 * Trade statistics — pure functions extracted VERBATIM from the inline math in
 * Dashboard.tsx and CryptoDashboard.tsx (which had duplicated copies), so the
 * admin redesign never rewrites a formula inside a component.
 *
 * Extraction contract: behavior is bit-identical to the previous inline code —
 * same null/zero handling (`net_pnl || 0`, `saldo_akun || 0`), same peak seed,
 * same division guards. Verified against real journal trades at extraction
 * time (see redesign Phase 0 report). DO NOT "improve" the math here without
 * an explicit decision from Sanz.
 */

import { getDay, parseISO } from 'date-fns';

type PnlRow = { net_pnl?: number | null };
type BalanceRow = { saldo_akun?: number | null };

export type WinLossStats = {
  winRate: number; // percent 0..100
  wonCount: number;
  lostCount: number;
  totalClosed: number;
};

/** Win rate over closed trades: wins are net_pnl > 0, losses net_pnl < 0
 *  (net_pnl null/0 counts in the denominator but in neither bucket). */
export function winLossStats(closedTrades: PnlRow[]): WinLossStats {
  const wonTrades = closedTrades.filter(t => (t.net_pnl || 0) > 0);
  const lostTrades = closedTrades.filter(t => (t.net_pnl || 0) < 0);
  const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;
  return { winRate, wonCount: wonTrades.length, lostCount: lostTrades.length, totalClosed: closedTrades.length };
}

/**
 * Max drawdown (%): largest peak-to-trough decline in the saldo_akun replay
 * across closed trades, in the order given (callers pass replay order:
 * tanggal asc, created_at asc). `initialPeak` is the desk's modal awal
 * (settings.modal_awal / settings.modal_awal_crypto, `|| 0` like the original).
 */
export function maxDrawdownPct(closedTrades: BalanceRow[], initialPeak: number): number {
  let peak = initialPeak;
  let maxDrawdown = 0;
  closedTrades.forEach(t => {
    const balance = t.saldo_akun || 0;
    if (balance > peak) peak = balance;
    if (peak > 0) {
      const drawdown = ((peak - balance) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  });
  return maxDrawdown;
}

export type GroupedWinRate = {
  name: string;
  total: number;
  winRate: number;
  wins: number;
  losses: number;
};

/**
 * Win rate grouped by an arbitrary key (psychology tag, setup, coin, …).
 * Rows with net_pnl null/undefined are skipped entirely (as in the original
 * psychologyInsights). Sorted by group size descending.
 */
export function groupedWinRates<T extends PnlRow>(closedTrades: T[], keyOf: (t: T) => string): GroupedWinRate[] {
  const map = new Map<string, { total: number; wins: number }>();
  closedTrades.forEach(t => {
    if (t.net_pnl === null || t.net_pnl === undefined) return;
    const name = keyOf(t);
    const cur = map.get(name) || { total: 0, wins: 0 };
    map.set(name, { total: cur.total + 1, wins: cur.wins + (t.net_pnl > 0 ? 1 : 0) });
  });
  return Array.from(map.entries())
    .map(([name, d]) => ({ name, total: d.total, winRate: (d.wins / d.total) * 100, wins: d.wins, losses: d.total - d.wins }))
    .sort((a, b) => b.total - a.total);
}

export type WeekdayPnl = { day: string; profit: number; loss: number };

/**
 * Profit/|loss| totals bucketed by weekday of `tanggal`, Monday–Friday only.
 * Rows with falsy net_pnl (null/0) are skipped, as in the original.
 */
export function pnlByWeekday(closedTrades: (PnlRow & { tanggal: string })[]): WeekdayPnl[] {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const result = days.map(day => ({ day, profit: 0, loss: 0 }));
  closedTrades.forEach(t => {
    if (t.net_pnl) {
      const dayIdx = getDay(parseISO(t.tanggal));
      if (t.net_pnl > 0) result[dayIdx].profit += t.net_pnl;
      else result[dayIdx].loss += Math.abs(t.net_pnl);
    }
  });
  return result.slice(1, 6);
}

/** Total spot cost basis: Σ quantity × average buy price. */
export function spotInvested(holdings: { jumlah_koin: number; harga_beli_rata: number }[]): number {
  return holdings.reduce((sum, h) => sum + h.jumlah_koin * h.harga_beli_rata, 0);
}
