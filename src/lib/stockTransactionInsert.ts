/**
 * Stock transaction insert path — extracted VERBATIM from StockTransactionEntry's
 * onSubmit (redesign Phase 4) so the full form and the CommandBar share ONE write
 * path. Unlike forex/crypto this is a THREE-step flow, order preserved exactly:
 *
 *   1. validate  — sell can't exceed the held lot; buy can't exceed the Trading
 *      balance. Both callers get this guard (the CommandBar can't skip it).
 *   2. insert stock_transactions
 *   3. insert the linked Trading cash flow (source of truth for balances)
 *   4. recalculateHolding LAST (idempotent — re-derives from all transactions;
 *      if it throws, the transaction + cash flow are already saved and only the
 *      holdings summary is stale, and re-running self-heals).
 *
 * Callers own cache invalidation (['stock_transactions'], ['cash_flows'],
 * ['stock_holdings']) and navigation. DO NOT add business logic here without an
 * explicit decision from Sanz.
 */
import { supabase } from './supabase';
import { recalculateHolding } from './stockCalc';
import { calculateDeskBalances } from './balanceCalc';
import { getCurrencyForDesk } from '../types';
import type { StockHolding, CashFlow } from '../types';

export type NewStockTransaction = {
  tanggal: string;
  emiten: string;
  market: 'IDX' | 'US' | 'CRYPTO';
  tipe: 'Buy' | 'Sell';
  lot: number;
  harga: number;
  komisi?: number;
  analysis_tag?: string;
  catatan?: string;
};

export type StockInsertContext = {
  holdings: StockHolding[];
  cashFlows: CashFlow[];
};

/** Returns { error } — null on success, an Error (validation or write) otherwise.
 *  Never throws; mirrors the Supabase { error } convention the other desks use. */
export async function insertStockTransaction(
  data: NewStockTransaction,
  { holdings, cashFlows }: StockInsertContext
): Promise<{ error: Error | null }> {
  const komisi = data.komisi || 0;
  const emiten = data.emiten.toUpperCase().trim();

  // 1. Validation — identical to the form's pre-submit guards.
  if (data.tipe === 'Sell') {
    const held = holdings.find(h => h.emiten === emiten)?.total_lot || 0;
    if (data.lot > held) {
      return { error: new Error(`Cannot sell ${data.lot} lot — you only hold ${held} lot of ${emiten}.`) };
    }
  }

  const totalShares = data.lot * 100;
  const grossValue = totalShares * data.harga;

  if (data.tipe === 'Buy') {
    const requiredCost = grossValue + komisi;
    const sahamBalances = calculateDeskBalances(cashFlows, 'Saham');
    if (requiredCost > sahamBalances.trading) {
      return { error: new Error(`Insufficient Trading Account balance. Required: Rp${requiredCost.toLocaleString()} | Available: Rp${sahamBalances.trading.toLocaleString()}. Transfer funds from your Funding Account first.`) };
    }
  }

  try {
    // 2. Insert transaction
    const txResponse = await supabase.from('stock_transactions').insert({
      tanggal: data.tanggal,
      emiten,
      market: data.market,
      tipe: data.tipe,
      lot: data.lot,
      harga: data.harga,
      komisi,
      analysis_tag: data.analysis_tag || null,
      catatan: data.catatan || null,
    }).select();
    if (txResponse.error) throw txResponse.error;

    // 3. Record the linked cash flow (source of truth)
    if (data.tipe === 'Buy') {
      // Cash out: cost + commission
      const { error: cfError } = await supabase.from('cash_flows').insert({
        tanggal: data.tanggal,
        tipe: 'Withdraw',
        jumlah: grossValue + komisi,
        desk: 'Saham',
        currency: getCurrencyForDesk('Saham'),
        account_type: 'Trading',
        is_trading_proceeds: true,
        catatan: `Buy ${data.lot} lot ${emiten} @ ${data.harga.toLocaleString()}`,
      });
      if (cfError) throw cfError;
    } else {
      // Cash in: proceeds - commission
      const { error: cfError } = await supabase.from('cash_flows').insert({
        tanggal: data.tanggal,
        tipe: 'Deposit',
        jumlah: grossValue - komisi,
        desk: 'Saham',
        currency: getCurrencyForDesk('Saham'),
        account_type: 'Trading',
        is_trading_proceeds: true,
        catatan: `Sell ${data.lot} lot ${emiten} @ ${data.harga.toLocaleString()}`,
      });
      if (cfError) throw cfError;
    }

    // 4. Recalculate the derived holding LAST (idempotent — see header note).
    await recalculateHolding(emiten, data.market);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e : new Error(String(e)) };
  }
}
