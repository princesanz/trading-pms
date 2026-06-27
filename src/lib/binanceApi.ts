/**
 * Binance public price feed (no API key needed for public ticker data).
 *
 * Uses the all-tickers endpoint (no params) which returns every spot symbol in
 * one request. We deliberately avoid the ?symbols=[...] form: that returns HTTP
 * 400 for the WHOLE request if any one symbol is invalid/delisted, which would
 * break live prices for every holding. With all-tickers, an unknown coin simply
 * isn't in the map → that row degrades to "no live price" while everything else
 * keeps working.
 *
 * Verified browser-accessible: returns `Access-Control-Allow-Origin: *`, and a
 * plain GET with no custom headers triggers no CORS preflight.
 */

const BINANCE_ALL_TICKERS = 'https://api.binance.com/api/v3/ticker/price';

/** symbol (e.g. "BTCUSDT") → last price */
export type PriceMap = Map<string, number>;

/**
 * Fetch all Binance spot ticker prices in a single request.
 * Throws on network/HTTP/parse failure — callers catch and degrade gracefully.
 * Bad individual rows are skipped (Number-guarded), never producing NaN.
 */
export async function fetchAllPrices(signal?: AbortSignal): Promise<PriceMap> {
  const res = await fetch(BINANCE_ALL_TICKERS, { signal });
  if (!res.ok) throw new Error(`Binance responded ${res.status} ${res.statusText}`);

  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('Unexpected Binance response shape');

  const map: PriceMap = new Map();
  for (const row of data) {
    const symbol = typeof row?.symbol === 'string' ? row.symbol : null;
    const price = Number(row?.price);
    if (symbol && Number.isFinite(price) && price > 0) {
      map.set(symbol, price);
    }
  }
  return map;
}
