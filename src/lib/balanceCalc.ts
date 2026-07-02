import type { CashFlow, CashFlowType } from '../types';

/**
 * Normalizes legacy cash_flow_type enum values carried over from the old
 * Supabase DB into the canonical four the app uses. The migrated DB's enum
 * contains BOTH generations: 'Deposit', 'Withdraw', 'Transfer Masuk',
 * 'Transfer Keluar' (current) plus 'Withdrawal' and 'Transfer' (legacy).
 *
 *   'Withdrawal' → 'Withdraw'      (pure rename)
 *   'Transfer'   → 'Transfer Keluar' when desk_tujuan is set (old cross-desk
 *                  outgoing leg); otherwise null (direction unknowable — the
 *                  row is skipped rather than silently mis-signed).
 *
 * Every balance computation MUST go through this, otherwise legacy rows fall
 * through all branches and balances drift (e.g. Funding going negative when
 * sweep-out rows are counted but their legacy inflows are not).
 */
export function normalizeCashFlowTipe(cf: Pick<CashFlow, 'tipe' | 'desk_tujuan'>): CashFlowType | null {
  const tipe = cf.tipe as string;
  switch (tipe) {
    case 'Deposit':
    case 'Withdraw':
    case 'Transfer Masuk':
    case 'Transfer Keluar':
      return tipe;
    case 'Withdrawal':
      return 'Withdraw';
    case 'Transfer':
      return cf.desk_tujuan ? 'Transfer Keluar' : null;
    default:
      return null;
  }
}

/**
 * Calculates the balance of a specific account (Funding or Trading)
 * for a given desk by summing all cash_flows entries.
 *
 * Deposits + Transfer Masuk add to the balance.
 * Withdrawals + Transfer Keluar subtract from the balance.
 */
export function calculateAccountBalance(
  cashFlows: CashFlow[],
  desk: string,
  accountType: 'Funding' | 'Trading'
): number {
  let balance = 0;
  cashFlows.forEach(cf => {
    if (cf.desk !== desk || cf.account_type !== accountType) return;
    const tipe = normalizeCashFlowTipe(cf);
    if (tipe === 'Deposit' || tipe === 'Transfer Masuk') {
      balance += Number(cf.jumlah);
    } else if (tipe === 'Withdraw' || tipe === 'Transfer Keluar') {
      balance -= Number(cf.jumlah);
    }
  });
  return balance;
}

/**
 * Calculates both Funding and Trading balances for a desk.
 * Returns the Trading balance as the "Available Cash" that can be used for trading.
 */
export function calculateDeskBalances(
  cashFlows: CashFlow[],
  desk: string
): { funding: number; trading: number } {
  return {
    funding: calculateAccountBalance(cashFlows, desk, 'Funding'),
    trading: calculateAccountBalance(cashFlows, desk, 'Trading'),
  };
}

/**
 * "Modal Awal" (net capital still entrusted to a desk), from that desk's
 * standalone perspective:
 *   + external Deposits      − external Withdrawals
 *   + cross-desk transfers IN − cross-desk transfers OUT
 *
 * Withdrawing realized profit reduces capital at risk, so Total P&L
 * (Equity − Modal Awal) correctly stays positive after a profitable withdrawal.
 *
 * Cross-desk transfers move capital between desks, so they count (capital is
 * genuinely gone from / arrived at this desk). They are distinguished from
 * INTERNAL Funding↔Trading transfers by desk_tujuan: cross-desk legs have it
 * populated, internal legs have it NULL. Internal transfers are NOT counted —
 * the money never left the desk, it just changed accounts.
 *
 * Excluded from the Deposit/Withdraw terms (real balance events, but not capital):
 *   - is_reversal: offsetting row from deleting a holding/transaction.
 *   - is_trading_proceeds: internal trading activity (Saham Buy debit / Sell credit).
 * (These flags are only ever set on Deposit/Withdraw rows, never on transfers.)
 */
export function calculateNetCapital(cashFlows: CashFlow[], desk: string): number {
  return cashFlows.reduce((sum, cf) => {
    if (cf.desk !== desk) return sum;
    const amt = Number(cf.jumlah);
    const tipe = normalizeCashFlowTipe(cf);

    // External capital in/out.
    if (!cf.is_reversal && !cf.is_trading_proceeds) {
      if (tipe === 'Deposit') return sum + amt;
      if (tipe === 'Withdraw') return sum - amt;
    }
    // Cross-desk transfers (desk_tujuan set); internal Funding↔Trading legs are NULL → ignored.
    if (cf.desk_tujuan) {
      if (tipe === 'Transfer Keluar') return sum - amt;
      if (tipe === 'Transfer Masuk') return sum + amt;
    }
    return sum;
  }, 0);
}

/**
 * Sums realized P&L across closed trades. Accepts any trade-like list
 * (Forex trades or Crypto futures trades) via a structural type, so this
 * module stays free of concrete trade-type imports.
 */
export function sumClosedNetPnl(
  trades: { status: string; net_pnl?: number | null }[]
): number {
  return trades
    .filter(t => t.status === 'Closed' && t.net_pnl != null)
    .reduce((sum, t) => sum + Number(t.net_pnl), 0);
}

/**
 * Effective Trading Account balance for the saldo_akun-replay desks
 * (Forex, Crypto Futures), where trade P&L is NOT written to cash_flows
 * and lives only in trades.net_pnl.
 *
 *   = Trading-account cash flows (deposits/transfers in − out)
 *   + realized P&L of all closed trades
 *
 * Do NOT use for Saham/Spot — those write buy/sell directly to cash_flows,
 * so calculateDeskBalances(...).trading is already complete for them.
 */
export function calculateEffectiveTradingBalance(
  cashFlows: CashFlow[],
  desk: string,
  trades: { status: string; net_pnl?: number | null }[]
): number {
  return calculateAccountBalance(cashFlows, desk, 'Trading') + sumClosedNetPnl(trades);
}
