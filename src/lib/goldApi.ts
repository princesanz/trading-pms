/**
 * gold-api.com — free, no-API-key public price feed.
 *
 * Verified live (HTTP 200, Access-Control-Allow-Origin: *) — plain GET, no
 * preflight. Cache-Control: max-age=16, so 5s polling reads the same value
 * ~3 times between upstream refreshes — fine for gold (low-frequency).
 *
 * Today we only fetch XAU (Gold), exposed under the key 'XAUUSD' to match our
 * stored instrument. The function returns a `Map` so future symbols (XAG,
 * indices, etc.) slot in additively without changing the consumer shape.
 *
 * Response example:
 *   { symbol: "XAU", price: 4156.7, currency: "USD", updatedAt: "...", ... }
 */

const GOLD_API_BASE = 'https://api.gold-api.com/price';

/** key = our app instrument symbol (e.g. 'XAUUSD'); value = last price in USD */
export type ForexPriceMap = Map<string, number>;

/**
 * Fetch the current XAU price and return it keyed as 'XAUUSD' (since gold is
 * USD-quoted, the upstream symbol XAU maps 1:1 to our XAUUSD instrument).
 * Throws on network/HTTP/parse failure — callers catch and degrade gracefully.
 */
export async function fetchForexPrices(signal?: AbortSignal): Promise<ForexPriceMap> {
  const res = await fetch(`${GOLD_API_BASE}/XAU`, { signal });
  if (!res.ok) throw new Error(`gold-api responded ${res.status} ${res.statusText}`);

  const data: unknown = await res.json();
  const price = Number((data as { price?: unknown })?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Unexpected gold-api response shape');

  const map: ForexPriceMap = new Map();
  map.set('XAUUSD', price);
  return map;
}
