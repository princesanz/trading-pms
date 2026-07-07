/**
 * Shared ordering for CLOSED-trade tables (internal Journal + public Track Record).
 *
 * Both pages sort by close date, but the date is day-granularity ("2026-07-07", no time), so
 * trades closed on the same day tie. JS sort is stable, so ties fell back to each array's
 * pre-sort order — which differed between the pages (Journal fetches `trades` directly; the
 * public page merges Forex+Crypto+Stock from separate sources), producing DIFFERENT orderings
 * for identical history. This comparator makes ties deterministic so both pages agree.
 *
 * Order:
 *   1. close date DESC (rows without a close date sink to the bottom)
 *   2. trade_number DESC — higher number = closed more recently (assigned sequentially at
 *      insert). Rows without a trade_number (Crypto/Stock — only Forex has IDs) are treated as
 *      lowest, so on a shared day they sort BELOW the ID'd Forex rows rather than interleaving
 *      unpredictably. This guarantees the Forex subset's relative order is identical on both pages.
 *   3. finer timestamp DESC when available (a fallback for rows that lack a trade_number but
 *      carry a more precise timestamp than the display date)
 *   4. otherwise fully tied → stable (original relative order preserved)
 */
export type ClosedSortKey = {
  closeDate?: string | null;
  tradeNumber?: number | null;
  fallbackTs?: string | null;
};

export function compareClosedDesc(a: ClosedSortKey, b: ClosedSortKey): number {
  const ad = a.closeDate ?? '';
  const bd = b.closeDate ?? '';
  if (ad !== bd) {
    if (!ad) return 1;   // a missing → after b
    if (!bd) return -1;  // b missing → after a
    return bd.localeCompare(ad); // DESC
  }

  // Same close day → tie-break by trade_number DESC. Missing IDs are lowest (sink below Forex).
  const an = a.tradeNumber ?? Number.NEGATIVE_INFINITY;
  const bn = b.tradeNumber ?? Number.NEGATIVE_INFINITY;
  if (an !== bn) return bn - an;

  // Neither row has a trade_number (or they're equal) → try a finer timestamp, DESC.
  const at = a.fallbackTs ?? '';
  const bt = b.fallbackTs ?? '';
  if (at !== bt) {
    if (!at) return 1;
    if (!bt) return -1;
    return bt.localeCompare(at);
  }

  return 0; // fully tied → keep original relative order (stable sort)
}

/** Returns a new array sorted newest-closed-first, using {@link compareClosedDesc}. */
export function sortClosedDesc<T>(rows: T[], key: (row: T) => ClosedSortKey): T[] {
  return rows.slice().sort((x, y) => compareClosedDesc(key(x), key(y)));
}
