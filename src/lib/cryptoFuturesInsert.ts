/**
 * Crypto futures insert path — extracted VERBATIM from FuturesTradeEntry's
 * onSubmit (redesign Phase 3) so the full form and the CommandBar share ONE
 * write path. The insert payload is identical; callers own cache invalidation
 * (['crypto_futures_trades']) and navigation. No snapshots here (unlike forex —
 * crypto futures have no balance_at_open/session columns). DO NOT add business
 * logic here without an explicit decision from Sanz.
 */
import { supabase } from './supabase';

export type NewCryptoFuturesTrade = {
  tanggal: string;
  coin: string;
  posisi: 'Long' | 'Short';
  notional_usd: number;
  leverage: number;
  margin_mode: 'Cross' | 'Isolated';
  harga_entry: number;
  sl?: number | 0;
  tp?: number | 0;
  liquidation_price?: number | 0;
  funding_rate_paid?: number;
  setup?: string;
  psikologi?: string;
  catatan?: string;
};

export async function insertCryptoFuturesTrade(data: NewCryptoFuturesTrade) {
  return supabase.from('crypto_futures_trades').insert({
    tanggal: data.tanggal,
    coin: data.coin,
    posisi: data.posisi,
    notional_usd: data.notional_usd,
    leverage: data.leverage,
    margin_mode: data.margin_mode,
    harga_entry: data.harga_entry,
    sl: data.sl || null,
    tp: data.tp || null,
    liquidation_price: data.liquidation_price || null,
    funding_rate_paid: data.funding_rate_paid || 0,
    setup: data.setup || null,
    psikologi: data.psikologi || null,
    catatan: data.catatan,
    status: 'Open',
  }).select();
}
