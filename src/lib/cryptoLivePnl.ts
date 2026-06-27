/**
 * Pure live-P&L math for the Crypto desk — single source of truth shared by the
 * Spot/Futures tables and the dashboard so every surface shows identical numbers.
 *
 * No double-counting: REALIZED values live in the DB (Funding/Trading cash,
 * closed-futures net_pnl, spot cost basis). UNREALIZED is computed here from live
 * prices. When a price is unavailable, every function falls back to its realized
 * value (spot → cost basis, futures → 0), so total equity collapses exactly to
 * the cost-basis numbers and the feature is purely additive.
 */
import type { CryptoSpotHolding, CryptoFuturesTrade } from '../types';
import type { PriceMap } from './binanceApi';

/** Resolve a stored coin symbol to a live price: exact match, then `${coin}USDT` fallback. */
export function resolvePrice(prices: PriceMap, coin: string): number | undefined {
  const sym = coin.trim().toUpperCase();
  return prices.get(sym) ?? prices.get(`${sym}USDT`);
}

/** Spot position value at live price; falls back to cost basis when no price. */
export function spotMarkToMarket(h: CryptoSpotHolding, price?: number): number {
  const p = price != null && Number.isFinite(price) ? price : h.harga_beli_rata;
  return h.jumlah_koin * p;
}

/** Spot unrealized P&L; 0 when no live price. */
export function spotUnrealized(h: CryptoSpotHolding, price?: number): number {
  if (price == null || !Number.isFinite(price)) return 0;
  return (price - h.harga_beli_rata) * h.jumlah_koin;
}

/**
 * Futures unrealized P&L on notional (OPEN positions only).
 *   Long:  (price − entry) / entry × notional
 *   Short: (entry − price) / entry × notional
 * Leverage is irrelevant to raw P&L (it only governs margin/liquidation).
 * Returns 0 for closed positions, missing price, or missing entry.
 */
export function futuresUnrealized(t: CryptoFuturesTrade, price?: number): number {
  if (t.status !== 'Open' || price == null || !Number.isFinite(price) || !t.harga_entry) return 0;
  const direction = t.posisi === 'Long' ? 1 : -1;
  return direction * ((price - t.harga_entry) / t.harga_entry) * t.notional_usd;
}

/** Total unrealized P&L across spot holdings + open futures positions. */
export function cryptoUnrealizedTotal(
  holdings: CryptoSpotHolding[],
  openTrades: CryptoFuturesTrade[],
  prices: PriceMap
): number {
  let total = 0;
  for (const h of holdings) total += spotUnrealized(h, resolvePrice(prices, h.coin));
  for (const t of openTrades) total += futuresUnrealized(t, resolvePrice(prices, t.coin));
  return total;
}

/**
 * Live Total Equity for the Crypto desk:
 *   Funding + Trading(effective, realized) + Σ spot mark-to-market + Σ open-futures uPnL
 *
 * The futures margin is never deducted from Trading cash in our model, so an open
 * position contributes ONLY its unrealized P&L (no margin term) — no double count.
 * With no prices, spot uses cost basis and futures contribute 0 → equals the
 * realized cost-basis equity.
 */
export function cryptoLiveEquity(
  funding: number,
  tradingEffective: number,
  holdings: CryptoSpotHolding[],
  openTrades: CryptoFuturesTrade[],
  prices: PriceMap
): number {
  let spotMtm = 0;
  for (const h of holdings) spotMtm += spotMarkToMarket(h, resolvePrice(prices, h.coin));
  let futuresUpnl = 0;
  for (const t of openTrades) futuresUpnl += futuresUnrealized(t, resolvePrice(prices, t.coin));
  return funding + tradingEffective + spotMtm + futuresUpnl;
}
