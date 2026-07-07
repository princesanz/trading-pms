import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthProvider';

/**
 * Public read path — reads ONLY the curated `public_*` views (anon-granted),
 * never the raw tables. Used by the logged-out Overview. Admin keeps reading raw
 * tables directly. RLS is the real boundary; this hook just shapes the public data.
 */

export type DeskAggregate = { desk: string; currency: string; equity: number; modal_awal: number; pnl: number };
export type ForexOpen = { instrument: string; direction: string; lot: number; harga_entry: number; leverage: number; tanggal_buka: string; desk: string };
export type CryptoFuturesOpen = { coin: string; direction: string; quantity: number; notional_usd: number; harga_entry: number; leverage: number; tanggal_buka: string };
export type SpotHolding = { coin: string; quantity: number; avg_cost: number };
export type StockHolding = { ticker: string; quantity_lots: number; quantity_shares: number; avg_cost: number };
export type ForexClosed = { trade_number: number | null; instrument: string; direction: string; lot: number; harga_entry: number; harga_exit: number | null; net_pnl: number | null; persen_profit_loss: number | null; tanggal_buka: string; tanggal_tutup: string | null; desk: string };
export type CryptoFuturesClosed = { coin: string; direction: string; quantity: number; harga_entry: number; harga_exit: number | null; realized_pnl: number | null; persen_profit_loss: number | null; tanggal_buka: string; tanggal_tutup: string | null };
export type SpotSale = { coin: string; jumlah_koin_sold: number; harga_beli_rata_at_sell: number; harga_jual: number; realized_pnl: number; tanggal: string };
export type StockSell = { ticker: string; tipe: string; quantity_lots: number; quantity_shares: number; harga: number; tanggal: string };

export function usePublicData() {
  const { session, loading: authLoading } = useAuth();
  const [aggregates, setAggregates] = useState<DeskAggregate[]>([]);
  const [forexOpen, setForexOpen] = useState<ForexOpen[]>([]);
  const [cryptoFuturesOpen, setCryptoFuturesOpen] = useState<CryptoFuturesOpen[]>([]);
  const [spotHoldings, setSpotHoldings] = useState<SpotHolding[]>([]);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [forexClosed, setForexClosed] = useState<ForexClosed[]>([]);
  const [cryptoFuturesClosed, setCryptoFuturesClosed] = useState<CryptoFuturesClosed[]>([]);
  const [spotSales, setSpotSales] = useState<SpotSale[]>([]);
  const [stockSells, setStockSells] = useState<StockSell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.all([
      supabase.from('public_desk_aggregates').select('*'),
      supabase.from('public_forex_open_positions').select('*').order('tanggal_buka', { ascending: false }),
      supabase.from('public_crypto_futures_open').select('*').order('tanggal_buka', { ascending: false }),
      supabase.from('public_crypto_spot_holdings').select('*').order('coin'),
      supabase.from('public_stock_holdings').select('*').order('ticker'),
      supabase.from('public_forex_closed_trades').select('*').order('tanggal_tutup', { ascending: false, nullsFirst: false }),
      supabase.from('public_crypto_futures_closed').select('*').order('tanggal_tutup', { ascending: false, nullsFirst: false }),
      supabase.from('public_crypto_spot_sales').select('*').order('tanggal', { ascending: false }),
      supabase.from('public_stock_transactions').select('*').order('tanggal', { ascending: false }),
    ]);

    const firstError = results.find(r => r.error)?.error;
    if (firstError) {
      console.error('[usePublicData] fetch error:', firstError);
      setError(firstError.message);
    }
    const [
      { data: agg },
      { data: fOpen }, { data: cOpen },
      { data: spot }, { data: stock },
      { data: fClosed }, { data: cClosed },
      { data: sSales }, { data: sSells },
    ] = results;

    if (agg) setAggregates(agg as DeskAggregate[]);
    if (fOpen) setForexOpen(fOpen as ForexOpen[]);
    if (cOpen) setCryptoFuturesOpen(cOpen as CryptoFuturesOpen[]);
    if (spot) setSpotHoldings(spot as SpotHolding[]);
    if (stock) setStockHoldings(stock as StockHolding[]);
    if (fClosed) setForexClosed(fClosed as ForexClosed[]);
    if (cClosed) setCryptoFuturesClosed(cClosed as CryptoFuturesClosed[]);
    if (sSales) setSpotSales(sSales as SpotSale[]);
    if (sSells) setStockSells(sSells as StockSell[]);
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    fetchData();
  }, [authLoading, session]);

  return {
    aggregates, forexOpen, cryptoFuturesOpen, spotHoldings, stockHoldings,
    forexClosed, cryptoFuturesClosed, spotSales, stockSells, loading: loading || authLoading, error, refetch: fetchData,
  };
}
