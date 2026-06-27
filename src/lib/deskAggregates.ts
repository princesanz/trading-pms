/**
 * Per-desk equity / P&L / Modal Awal composition — the SINGLE source of truth
 * shared by each desk's own dashboard AND the unified Overview, so the two can
 * never drift (a mismatch between Overview and a desk dashboard would be a bug).
 *
 * These functions only COMPOSE the existing balance/equity helpers — they add no
 * new math and never touch cash_flows, Modal Awal logic, or persistence.
 *
 * Forex & Crypto summaries are in USD (Crypto's USDT treated as USD 1:1).
 * Saham is returned in native IDR — the caller converts to USD via the FX rate.
 */
import type { Trade, CryptoFuturesTrade, CryptoSpotHolding, StockHolding, CashFlow } from '../types';
import type { ForexPriceMap } from './goldApi';
import type { PriceMap } from './binanceApi';
import { calculateDeskBalances, calculateEffectiveTradingBalance, calculateNetCapital } from './balanceCalc';
import { forexLiveEquity } from './forexLivePnl';
import { cryptoLiveEquity } from './cryptoLivePnl';

export type DeskSummary = {
  funding: number;
  trading: number;   // effective Trading balance (cash + realized closed-trade P&L)
  equity: number;    // total equity incl. live unrealized where a feed exists
  modalAwal: number; // net external capital
  pnl: number;       // equity − modalAwal
};

export function forexDeskSummary(cashFlows: CashFlow[], trades: Trade[], forexPrices: ForexPriceMap): DeskSummary {
  const funding = calculateDeskBalances(cashFlows, 'Forex').funding;
  const trading = calculateEffectiveTradingBalance(cashFlows, 'Forex', trades);
  const openTrades = trades.filter(t => t.status === 'Open');
  const equity = forexLiveEquity(funding, trading, openTrades, forexPrices);
  const modalAwal = calculateNetCapital(cashFlows, 'Forex');
  return { funding, trading, equity, modalAwal, pnl: equity - modalAwal };
}

export function cryptoDeskSummary(
  cashFlows: CashFlow[],
  futuresTrades: CryptoFuturesTrade[],
  spotHoldings: CryptoSpotHolding[],
  cryptoPrices: PriceMap
): DeskSummary {
  const funding = calculateDeskBalances(cashFlows, 'Crypto').funding;
  const trading = calculateEffectiveTradingBalance(cashFlows, 'Crypto', futuresTrades);
  const openTrades = futuresTrades.filter(t => t.status === 'Open');
  const equity = cryptoLiveEquity(funding, trading, spotHoldings, openTrades, cryptoPrices);
  const modalAwal = calculateNetCapital(cashFlows, 'Crypto');
  return { funding, trading, equity, modalAwal, pnl: equity - modalAwal };
}

/** Saham summary in native IDR. Equity = funding + trading + holdings cost basis
 *  (stocks have no live price feed, so no unrealized component). */
export function sahamDeskSummary(cashFlows: CashFlow[], holdings: StockHolding[]): DeskSummary {
  const { funding, trading } = calculateDeskBalances(cashFlows, 'Saham');
  const portfolioValue = holdings
    .filter(h => h.total_lot > 0)
    .reduce((sum, h) => sum + h.total_cost_basis, 0);
  const equity = funding + trading + portfolioValue;
  const modalAwal = calculateNetCapital(cashFlows, 'Saham');
  return { funding, trading, equity, modalAwal, pnl: equity - modalAwal };
}
