/**
 * Trading-session classification from a trade's open timestamp (UTC).
 *
 * The market windows are defined in each market's *local* wall-clock time. We convert
 * the UTC instant into each market timezone with the built-in `Intl` API, which is
 * fully DST-aware (it uses the IANA tz database), so we NEVER hardcode UTC offsets and
 * never read the device's local time. This mirrors the Luxon/date-fns-tz approach the
 * spec calls for, without pulling in an extra dependency.
 *
 * Windows (local, [start, end)):
 *   - Asian:    Asia/Tokyo        09:00–18:00
 *   - London:   Europe/London     08:00–16:00
 *   - New York: America/New_York  08:00–17:00
 *
 * Resolution:
 *   - London AND New York both match -> "London/NY Overlap"
 *   - else single-match precedence:  New York > London > Asian
 *   - none match -> "Off-session"
 */

const MARKET_TZ = {
  tokyo: 'Asia/Tokyo',
  london: 'Europe/London',
  newYork: 'America/New_York',
} as const;

export type TradingSession = 'Asian' | 'London' | 'New York' | 'London/NY Overlap' | 'Off-session';

/** Minutes-since-midnight of the given UTC instant expressed in the target IANA timezone. */
function minutesInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', // 00–23, avoids the "24:00" edge some engines emit at midnight
  }).formatToParts(date);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value);
    if (p.type === 'minute') m = Number(p.value);
  }
  return h * 60 + m;
}

/**
 * Classify the trading session for a UTC open timestamp.
 * Accepts an ISO string or Date. Invalid/empty input -> "Off-session".
 */
export function classifySession(openTs: string | Date | null | undefined): TradingSession {
  if (!openTs) return 'Off-session';
  const d = typeof openTs === 'string' ? new Date(openTs) : openTs;
  if (isNaN(d.getTime())) return 'Off-session';

  const tokyo = minutesInTz(d, MARKET_TZ.tokyo);
  const london = minutesInTz(d, MARKET_TZ.london);
  const newYork = minutesInTz(d, MARKET_TZ.newYork);

  const isAsian = tokyo >= 9 * 60 && tokyo < 18 * 60;
  const isLondon = london >= 8 * 60 && london < 16 * 60;
  const isNewYork = newYork >= 8 * 60 && newYork < 17 * 60;

  if (isLondon && isNewYork) return 'London/NY Overlap';
  if (isNewYork) return 'New York';
  if (isLondon) return 'London';
  if (isAsian) return 'Asian';
  return 'Off-session';
}
