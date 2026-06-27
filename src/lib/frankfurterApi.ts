/**
 * Frankfurter.dev — free, keyless FX rates (CORS open: Access-Control-Allow-Origin: *).
 *
 * Verified: GET /v2/rate/USD/IDR → { date, base:"USD", quote:"IDR", rate: 17839 }.
 * `rate` is IDR per 1 USD, so to convert a Saham IDR value to USD: usd = idr / rate.
 * Upstream caches ~1 day (Cache-Control max-age=86400), so hourly polling is ample.
 */

const FRANKFURTER_RATE = 'https://api.frankfurter.dev/v2/rate';

/** Fallback when no rate has ever been fetched this session. Live is ~17,839 (Jun 2026);
 *  this is a rough stand-in only — the UI flags any value derived from it as approximate. */
export const FALLBACK_USD_IDR = 16500;

/** Fetch USD/IDR (IDR per 1 USD). Throws on network/HTTP/parse failure. */
export async function fetchUsdIdrRate(signal?: AbortSignal): Promise<number> {
  const res = await fetch(`${FRANKFURTER_RATE}/USD/IDR`, { signal });
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status} ${res.statusText}`);
  const data: unknown = await res.json();
  const rate = Number((data as { rate?: unknown })?.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Unexpected Frankfurter response shape');
  return rate;
}
