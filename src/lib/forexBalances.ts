import { supabase } from './supabase';
import { normalizeCashFlowTipe } from './balanceCalc';

/**
 * Recalculates saldo_akun, persen_profit_loss for ALL closed trades chronologically,
 * factoring in cash flow events. Call this after any PnL update or trade closure.
 *
 * @param overridePnl — Optional: { tradeId, pnlValue } to override net_pnl for a specific trade
 *                      before recalculating (used when closing a trade with a new PnL value).
 */
export async function recalculateBalances(overridePnl?: { tradeId: string; pnlValue: number }) {
  const { data: allTrades, error: tradesError } = await supabase
    .from('trades')
    .select('*')
    .order('tanggal', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: cashFlows, error: cashFlowsError } = await supabase
    .from('cash_flows')
    .select('*')
    .eq('desk', 'Forex')
    .order('tanggal', { ascending: true });

  // maybeSingle: a missing settings row (fresh migrated DB) must not hard-fail
  // the whole close/delete — we fall back to modal_awal = 0.
  const { data: settings, error: settingsError } = await supabase
    .from('account_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  const readError = tradesError || cashFlowsError || settingsError;
  if (readError) {
    throw new Error(`Could not load data to recalculate account balances. Balances were not updated — refresh the Journal and try again. (${readError.message})`);
  }
  if (!allTrades) return;

  let currentBalance: number = Number(settings?.modal_awal ?? 0);

  // Merge trades and cash flows into a single chronological event stream
  type Event = { type: 'trade'; date: number; createdAt: string; data: typeof allTrades[0] }
             | { type: 'cashflow'; date: number; createdAt: string; data: NonNullable<typeof cashFlows>[0] };

  const events: Event[] = [];
  allTrades.forEach(t => events.push({
    type: 'trade',
    date: new Date(t.tanggal).getTime(),
    createdAt: t.created_at,
    data: t,
  }));
  cashFlows?.forEach(cf => events.push({
    type: 'cashflow',
    date: new Date(cf.tanggal).getTime(),
    createdAt: cf.created_at,
    data: cf,
  }));

  // Sort by date, then by created_at for same-day events
  events.sort((a, b) => a.date - b.date || a.createdAt.localeCompare(b.createdAt));

  const updates: { id: string; net_pnl: number; saldo_akun: number; persen_profit_loss: number; status: string }[] = [];

  for (const ev of events) {
    if (ev.type === 'cashflow') {
      const cf = ev.data;
      const tipe = normalizeCashFlowTipe(cf);
      if (tipe === 'Deposit' || tipe === 'Transfer Masuk') {
        currentBalance += Number(cf.jumlah);
      } else if (tipe === 'Withdraw' || tipe === 'Transfer Keluar') {
        currentBalance -= Number(cf.jumlah);
      }
    } else if (ev.type === 'trade') {
      const t = ev.data;

      // Determine PnL: use override if this is the trade being closed/edited, otherwise use stored
      let pnl: number | null = t.net_pnl;
      let newStatus = t.status;
      if (overridePnl && t.id === overridePnl.tradeId) {
        pnl = overridePnl.pnlValue;
        newStatus = 'Closed';
      }

      // Only closed trades with a PnL affect the running balance
      if (newStatus === 'Closed' && pnl !== null && pnl !== undefined) {
        const prevBalance = currentBalance;
        currentBalance += Number(pnl);
        const pct = prevBalance !== 0 ? (Number(pnl) / prevBalance) * 100 : 0;

        updates.push({
          id: t.id,
          net_pnl: Number(pnl),
          saldo_akun: currentBalance,
          persen_profit_loss: pct,
          status: 'Closed',
        });
      }
    }
  }

  // Batch update all affected trades. Stop on the first failure: this function re-derives
  // every closed trade's balance from scratch, so a partial run is fully fixed by re-running.
  let done = 0;
  for (const update of updates) {
    const { error: updateError } = await supabase.from('trades').update({
      net_pnl: update.net_pnl,
      saldo_akun: update.saldo_akun,
      persen_profit_loss: update.persen_profit_loss,
      status: update.status,
    }).eq('id', update.id);
    if (updateError) {
      throw new Error(`Account balance recalculation failed after updating ${done} of ${updates.length} trade(s) (failed on trade ${update.id}). Balances are partially updated — refresh the Journal to recompute, or retry. (${updateError.message})`);
    }
    done++;
  }
}
