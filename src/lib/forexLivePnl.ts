/**
 * Pure live-P&L math for the Forex desk — single source of truth shared by
 * the Trade Journal table and the Forex Dashboard so every surface shows
 * identical numbers.
 *
 * Today only XAUUSD has a live price. Other open Forex positions (forex
 * majors, DJI30/NDX100/SPX500) contribute 0 to unrealized P&L — they keep
 * showing exactly what they did before this feature shipped. Adding more
 * symbols later is purely additive: extend the price feed and add their
 * symbol to FOREX_LIVE_SYMBOLS.
 *
 * No double-counting: REALIZED values live in the DB (closed trades' net_pnl,
 * Funding/Trading cash). UNREALIZED comes from live prices on OPEN positions
 * only. When a price is unavailable, this returns 0 → Total Equity collapses
 * exactly to the pre-existing realized-only number, so the feature is purely
 * additive and can't corrupt the stabilized realized math.
 *
 * Margin/leverage note: leverage governs MARGIN (capital tied up) and
 * liquidation, not raw P&L per point. Unrealized P&L is computed on full
 * notional movement, matching the established Crypto Futures convention.
 */
import type { Trade } from '../types';
import { getContractSize } from '../types';
import type { ForexPriceMap } from './goldApi';

/** Instruments that have a live price feed today. Add more here as feeds are wired. */
export const FOREX_LIVE_SYMBOLS = new Set(['XAUUSD']);

export function isForexLiveSymbol(instrument: string | undefined | null): boolean {
  return !!instrument && FOREX_LIVE_SYMBOLS.has(instrument.toUpperCase());
}

/**
 * Unrealized P&L for an OPEN Forex position:
 *   Buy:  (price − entry) × lot × contractSize
 *   Sell: (entry − price) × lot × contractSize
 *
 * Returns 0 for closed trades, instruments without a live price, missing
 * entry/lot, or undefined price.
 */
export function forexUnrealized(t: Trade, price?: number): number {
  if (t.status !== 'Open') return 0;
  if (!isForexLiveSymbol(t.instrumen)) return 0;
  if (price == null || !Number.isFinite(price)) return 0;
  if (!t.harga_entry || !t.lot) return 0;
  const direction = t.posisi === 'Buy' ? 1 : -1;
  const contractSize = getContractSize(t.instrumen);
  return direction * (price - t.harga_entry) * t.lot * contractSize;
}

/** Sum of unrealized P&L across all open Forex positions that have a live price. */
export function forexUnrealizedTotal(openTrades: Trade[], prices: ForexPriceMap): number {
  let total = 0;
  for (const t of openTrades) {
    const price = prices.get(t.instrumen?.toUpperCase() ?? '');
    total += forexUnrealized(t, price);
  }
  return total;
}

/**
 * Live Total Equity for the Forex desk:
 *   Funding + Trading(effective, realized) + Σ open-position unrealized P&L
 *
 * Forex open trades never deduct margin from Trading cash in our model (same
 * as Crypto Futures), so an open position contributes ONLY its unrealized
 * P&L (no margin term) — no double count. With no live prices, unrealized = 0
 * → result equals the pre-existing realized equity.
 */
export function forexLiveEquity(
  funding: number,
  tradingEffective: number,
  openTrades: Trade[],
  prices: ForexPriceMap
): number {
  return funding + tradingEffective + forexUnrealizedTotal(openTrades, prices);
}
