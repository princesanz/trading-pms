/**
 * Sanity checks for src/lib/marketSessions.ts — run with:
 *   node scripts/verifyMarketSessions.ts        (Node ≥23, native TS stripping)
 * Exits non-zero if any assertion fails. No React, no test runner needed.
 *
 * Focus: the DST-sensitive conversion the spec calls out — US regular-hours
 * 09:30 ET must land on a DIFFERENT WIB clock time in January (EST, UTC−5) vs
 * July (EDT, UTC−4), proving the home-tz→WIB conversion tracks US daylight
 * saving instead of using a frozen offset.
 */
import { getSessionWindows, type SessionWindow } from '../src/lib/marketSessions.ts';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${tag}] ${name} — ${detail}`);
}

const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

const byKey = (wins: SessionWindow[], key: string) => wins.find((w) => w.key === key)!;

// 12:00 WIB (UTC+7) → 05:00 UTC on that WIB calendar day.
const wibNoon = (y: number, moIdx: number, d: number) =>
  new Date(Date.UTC(y, moIdx, d, 5, 0, 0));

// --- DST verification: US regular-hours start (09:30 ET) → WIB ---------------
// Jan 15 2026 (Thu, EST/UTC−5): 09:30 ET → 21:30 WIB.
// Jul 15 2026 (Wed, EDT/UTC−4): 09:30 ET → 20:30 WIB.
// The WIB day also holds the *previous* session's post-midnight tail as an
// earlier segment, so the actual open is the last (later-starting) segment.
const lastSeg = (w: SessionWindow) => w.segments[w.segments.length - 1];
const janReg = lastSeg(byKey(getSessionWindows(wibNoon(2026, 0, 15)), 'us-regular'));
const julReg = lastSeg(byKey(getSessionWindows(wibNoon(2026, 6, 15)), 'us-regular'));
const janStart = hhmm(janReg.startMin);
const julStart = hhmm(julReg.startMin);

console.log(`\n  US regular open 09:30 ET →  January (EST): ${janStart} WIB   |   July (EDT): ${julStart} WIB\n`);

check('US regular start — January (EST)', janStart === '21:30', `got ${janStart} WIB (expected 21:30)`);
check('US regular start — July (EDT)', julStart === '20:30', `got ${julStart} WIB (expected 20:30)`);
check('US regular WIB start shifts with US DST', janStart !== julStart, `${janStart} vs ${julStart}`);

// --- IDX Mon–Thu vs Friday session-1 end ------------------------------------
// IDX is Asia/Jakarta = WIB, so segment minutes are the raw local clock.
const thu = byKey(getSessionWindows(wibNoon(2026, 0, 15)), 'idx-1').segments[0]; // Thu
const fri = byKey(getSessionWindows(wibNoon(2026, 0, 16)), 'idx-1').segments[0]; // Fri
check('IDX sesi 1 Mon–Thu ends 12:00', hhmm(thu.endMin) === '12:00', `got ${hhmm(thu.endMin)}`);
check('IDX sesi 1 Friday ends 11:30', hhmm(fri.endMin) === '11:30', `got ${hhmm(fri.endMin)}`);

// --- New York FX straddles WIB midnight → two segments -----------------------
const ny = byKey(getSessionWindows(wibNoon(2026, 6, 15)), 'fx-ny');
check('New York FX renders as two WIB segments', ny.segments.length === 2, `got ${ny.segments.length} segment(s)`);

// --- Weekend: IDX closed on Saturday ----------------------------------------
const sat = byKey(getSessionWindows(wibNoon(2026, 0, 17)), 'idx-1'); // Sat
check('IDX inactive & empty on Saturday', !sat.active && sat.segments.length === 0, `active=${sat.active}, segs=${sat.segments.length}`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
