import { supabase } from './supabase';

/**
 * Recalculates the stock_holdings row for a given emiten
 * by walking through all stock_transactions chronologically.
 *
 * Average price = pure transaction price (komisi NOT folded in).
 * On Buy: weighted average recalculated.
 * On Sell: average_price unchanged, total_lot reduced.
 * If total_lot reaches 0: row kept with average_price = 0.
 */
export async function recalculateHolding(emiten: string) {
  const { data: txs, error: txError } = await supabase
    .from('stock_transactions')
    .select('*')
    .eq('emiten', emiten)
    .order('tanggal', { ascending: true })
    .order('created_at', { ascending: true });

  if (txError) {
    throw new Error(`Could not load transactions to recalculate the holding for ${emiten}. The holdings summary may be out of sync with its transactions — refresh the Portfolio page and try again. (${txError.message})`);
  }
  if (!txs) return;

  let totalLot = 0;
  let averagePrice = 0;

  for (const tx of txs) {
    const lot = Number(tx.lot);
    const price = Number(tx.harga);

    if (tx.tipe === 'Buy') {
      if (totalLot + lot > 0) {
        averagePrice = ((totalLot * averagePrice) + (lot * price)) / (totalLot + lot);
      }
      totalLot += lot;
    } else {
      // Sell — average_price stays the same
      totalLot -= lot;
      if (totalLot <= 0) {
        totalLot = 0;
        averagePrice = 0;
      }
    }
  }

  const totalCostBasis = totalLot * 100 * averagePrice;

  // Upsert: insert if new emiten, update if existing.
  // maybeSingle() so "no existing row yet" returns null instead of erroring.
  const { data: existing, error: existingError } = await supabase
    .from('stock_holdings')
    .select('id')
    .eq('emiten', emiten)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Could not read the existing holding for ${emiten} while recalculating. Holdings may be out of sync with transactions — refresh the Portfolio page and try again. (${existingError.message})`);
  }

  const outOfSyncMsg = `Holdings for ${emiten} may now be out of sync with its transactions. Refresh the Portfolio page (or log another transaction for ${emiten}) to recompute.`;

  if (existing) {
    const { error: updateError } = await supabase.from('stock_holdings').update({
      total_lot: totalLot,
      average_price: averagePrice,
      total_cost_basis: totalCostBasis,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    if (updateError) throw new Error(`Failed to update the holding for ${emiten}. ${outOfSyncMsg} (${updateError.message})`);
  } else {
    const { error: insertError } = await supabase.from('stock_holdings').insert({
      emiten,
      total_lot: totalLot,
      average_price: averagePrice,
      total_cost_basis: totalCostBasis,
    });
    if (insertError) throw new Error(`Failed to create the holding for ${emiten}. ${outOfSyncMsg} (${insertError.message})`);
  }
}
