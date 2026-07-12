/**
 * Forex trade insert path — extracted VERBATIM from TradeEntry.tsx's onSubmit
 * (redesign Phase 2) so the full form page and the CommandBar share ONE write
 * path. Snapshot semantics preserved exactly:
 *
 * - riskToReward derived from sl/tp when both present, stored as "1:x.xx"
 * - open_ts = UTC instant at submit; session classified from it (DST-aware)
 * - balance_at_open = realized balance replay (modal awal + cash flows +
 *   realized P&L) at the moment of open — never live-recomputed afterward
 * - point_value snapshotted from instrument_specs with the static
 *   contract-size fallback
 * - trade_number / risk_usd / risk_pct / rr_planned / rr_actual are assigned
 *   by the DB (sequence default / GENERATED columns / trigger)
 *
 * Callers own cache invalidation (['trades']) and navigation. DO NOT add
 * business logic here without an explicit decision from Sanz.
 */
import { supabase } from './supabase';
import { getContractSize } from '../types';
import { calculateRealizedBalance } from './balanceCalc';
import { classifySession } from './session';
import type { Trade, CashFlow, AccountSettings, InstrumentSpec } from '../types';

export type NewForexTrade = {
  tanggal: string;
  instrumen: string;
  category: 'forex' | 'crypto' | 'stock';
  posisi: 'Buy' | 'Sell';
  lot: number;
  leverage: number;
  harga_entry: number;
  sl?: number | 0;
  tp?: number;
  komisi_swap: number;
  setup?: string;
  psikologi?: string;
  catatan?: string;
};

export type ForexInsertContext = {
  settings: AccountSettings | null;
  cashFlows: CashFlow[];
  trades: Trade[];
  instrumentSpecs: InstrumentSpec[];
};

export async function insertForexTrade(data: NewForexTrade, ctx: ForexInsertContext) {
  const riskToReward = data.sl && data.tp
    ? (Math.abs(data.tp - data.harga_entry) / Math.abs(data.harga_entry - data.sl)).toFixed(2)
    : null;

  // Snapshots captured ONCE at open — never live-recomputed afterward.
  const openTs = new Date().toISOString();          // UTC instant
  const session = classifySession(openTs);          // DST-aware, UTC -> market tz
  const balance_at_open = calculateRealizedBalance(ctx.settings?.modal_awal ?? 0, ctx.cashFlows, 'Forex', ctx.trades);
  const specPointValue = (() => {
    const key = data.instrumen.toUpperCase();
    const spec = ctx.instrumentSpecs.find(s => s.instrument.toUpperCase() === key);
    return spec ? Number(spec.point_value) : getContractSize(data.instrumen);
  })();

  return supabase.from('trades').insert({
    tanggal: data.tanggal,
    instrumen: data.instrumen,
    category: data.category,
    posisi: data.posisi,
    lot: data.lot,
    leverage: data.leverage,
    harga_entry: data.harga_entry,
    sl: data.sl || null,
    tp: data.tp || null,
    komisi_swap: data.komisi_swap,
    setup: data.setup || null,
    psikologi: data.psikologi || null,
    catatan: data.catatan,
    risk_to_reward: riskToReward ? `1:${riskToReward}` : null,
    status: 'Open',
    // Phase 4 snapshots (trade_number, risk_usd, risk_pct, rr_planned, rr_actual are
    // assigned by the DB via the sequence default / GENERATED columns / trigger).
    open_ts: openTs,
    session,
    balance_at_open,
    point_value: specPointValue,
    // net_pnl, persen_profit_loss, and saldo_akun stay null until trade is closed.
  }).select();
}
