/**
 * Market session schedule — the single source of truth for the Overview
 * "Market Sessions" timeline. Pure + framework-free: no React, no `Date.now()`
 * in any exported function (callers pass the reference instant), so every
 * boundary is unit-testable.
 *
 * CORRECTNESS MODEL
 * -----------------
 * Session hours are defined ONCE in each market's HOME timezone (IANA id) and
 * converted to WIB (Asia/Jakarta) at call time via `@date-fns/tz` `TZDate`,
 * which resolves real IANA rules including daylight saving. We never hardcode a
 * WIB clock time for a foreign session and never hand-roll UTC offsets — the
 * US (EST↔EDT) and London (GMT↔BST) windows therefore shift automatically
 * across the year. WIB itself has no DST.
 *
 * A session's window is anchored to its home-local calendar day and weekday.
 * A window may land on the WIB axis before 00:00 or after 24:00 (e.g. New York
 * FX 08:00–17:00 ET → roughly 19:00/20:00–04:00/05:00 next-day WIB); such
 * windows are returned as one or two clipped segments within [0, 1440] WIB
 * minutes, so a bar that crosses WIB midnight renders as two pieces.
 *
 * SCOPE LIMITATION: public holidays are intentionally NOT modeled — there is no
 * holiday calendar here. On an exchange holiday a bar will still render as if
 * the market were open. Weekend closure IS handled (via per-schedule weekdays).
 * Crypto is deliberately absent (24/7, no official sessions).
 */
import { TZDate } from '@date-fns/tz';

export const WIB_TZ = 'Asia/Jakarta';
export const MINUTES_IN_DAY = 24 * 60;

/** Visual grouping → drives the row hue (kept to 3 groups, adm desk hues). */
export type SessionGroup = 'forex' | 'idx' | 'us';

/** A weekday-scoped window in HOME-local wall-clock time. `days`: 0=Sun … 6=Sat. */
type Schedule = {
  days: number[];
  /** [hour, minute] home-local. */
  start: [number, number];
  end: [number, number];
};

export type SessionDef = {
  key: string;
  label: string;
  group: SessionGroup;
  /** IANA timezone the hours are defined in. */
  homeTz: string;
  /** Human-readable home-tz hours, for the config/legend note. */
  homeHours: string;
  /** One entry per distinct weekday rule (IDX differs Mon–Thu vs Fri). */
  schedule: Schedule[];
};

const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const MON_THU = [1, 2, 3, 4];
const FRI = [5];

/**
 * Session definitions. Forex sessions use the conventional local business-day
 * window (08:00–17:00, Tokyo 09:00–18:00) each desk's home city trades; these
 * are transparent conventions, not an official exchange bell. IDX and US hours
 * are the official exchange schedules.
 *
 * IDX (Asia/Jakarta, no DST) — verified against the official IDX regular-market
 * schedule (idx.co.id): Mon–Thu Sesi 1 09:00–12:00 / Sesi 2 13:30–15:49; Fri
 * Sesi 1 09:00–11:30 / Sesi 2 14:00–15:49 (longer midday break for Jumat).
 */
export const SESSIONS: SessionDef[] = [
  {
    key: 'fx-sydney', label: 'Sydney FX', group: 'forex',
    homeTz: 'Australia/Sydney', homeHours: '08:00–17:00 Sydney',
    schedule: [{ days: WEEKDAYS, start: [8, 0], end: [17, 0] }],
  },
  {
    key: 'fx-tokyo', label: 'Tokyo FX', group: 'forex',
    homeTz: 'Asia/Tokyo', homeHours: '09:00–18:00 Tokyo',
    schedule: [{ days: WEEKDAYS, start: [9, 0], end: [18, 0] }],
  },
  {
    key: 'fx-london', label: 'London FX', group: 'forex',
    homeTz: 'Europe/London', homeHours: '08:00–17:00 London',
    schedule: [{ days: WEEKDAYS, start: [8, 0], end: [17, 0] }],
  },
  {
    key: 'fx-ny', label: 'New York FX', group: 'forex',
    homeTz: 'America/New_York', homeHours: '08:00–17:00 New York',
    schedule: [{ days: WEEKDAYS, start: [8, 0], end: [17, 0] }],
  },
  {
    key: 'idx-1', label: 'IDX sesi 1', group: 'idx',
    homeTz: WIB_TZ, homeHours: 'Mon–Thu 09:00–12:00 · Fri 09:00–11:30 WIB',
    schedule: [
      { days: MON_THU, start: [9, 0], end: [12, 0] },
      { days: FRI, start: [9, 0], end: [11, 30] },
    ],
  },
  {
    key: 'idx-2', label: 'IDX sesi 2', group: 'idx',
    homeTz: WIB_TZ, homeHours: 'Mon–Thu 13:30–15:49 · Fri 14:00–15:49 WIB',
    schedule: [
      { days: MON_THU, start: [13, 30], end: [15, 49] },
      { days: FRI, start: [14, 0], end: [15, 49] },
    ],
  },
  {
    key: 'us-pre', label: 'US pre-market', group: 'us',
    homeTz: 'America/New_York', homeHours: '04:00–09:30 ET',
    schedule: [{ days: WEEKDAYS, start: [4, 0], end: [9, 30] }],
  },
  {
    key: 'us-regular', label: 'US regular hours', group: 'us',
    homeTz: 'America/New_York', homeHours: '09:30–16:00 ET',
    schedule: [{ days: WEEKDAYS, start: [9, 30], end: [16, 0] }],
  },
];

/** A clipped bar segment on the WIB day axis, in minutes from WIB midnight. */
export type SessionSegment = { startMin: number; endMin: number };

export type SessionWindow = {
  key: string;
  label: string;
  group: SessionGroup;
  homeHours: string;
  /** 0–2 segments within [0, 1440]; two when the window straddles WIB midnight. */
  segments: SessionSegment[];
  /** True when `ref` falls inside the real (unclipped) window. */
  active: boolean;
};

/** WIB calendar-date parts of an instant. */
function wibDateParts(instant: Date): { y: number; mo: number; d: number } {
  const z = new TZDate(instant.getTime(), WIB_TZ);
  return { y: z.getFullYear(), mo: z.getMonth(), d: z.getDate() };
}

/** UTC ms at WIB 00:00 of the given WIB calendar date. */
function wibMidnightMs(y: number, mo: number, d: number): number {
  return new TZDate(y, mo, d, 0, 0, 0, WIB_TZ).getTime();
}

/** UTC ms for a home-local wall-clock time on a home calendar date. */
function homeWallClockMs(y: number, mo: number, d: number, h: number, min: number, tz: string): number {
  return new TZDate(y, mo, d, h, min, 0, tz).getTime();
}

/** Minutes-from-WIB-midnight for `ref` within its own WIB day (0–1440). */
export function wibMinutesOfDay(ref: Date): number {
  const { y, mo, d } = wibDateParts(ref);
  return (ref.getTime() - wibMidnightMs(y, mo, d)) / 60000;
}

/** True when `ref` falls on Saturday or Sunday in WIB. */
export function isWibWeekend(ref: Date): boolean {
  const wd = new TZDate(ref.getTime(), WIB_TZ).getDay();
  return wd === 0 || wd === 6;
}

/** "HH:MM" WIB wall-clock label for an instant. */
export function wibClockLabel(ref: Date): string {
  const z = new TZDate(ref.getTime(), WIB_TZ);
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`;
}

/**
 * Pure core: compute every session's WIB-day segments (and active flag) for the
 * WIB calendar day that `ref` falls in. `active` is evaluated against `ref`.
 *
 * For each session we probe the home-local calendar date at offsets −1/0/+1
 * around this WIB day and keep any window that intersects [00:00, 24:00) WIB,
 * clipped to that range — which naturally splits a midnight-straddling window
 * into two segments and pulls in the tail of the previous home-day's session
 * (e.g. New York FX bleeding into the early WIB morning).
 */
export function getSessionWindows(ref: Date): SessionWindow[] {
  const { y, mo, d } = wibDateParts(ref);
  const dayStart = wibMidnightMs(y, mo, d);
  const dayEnd = dayStart + MINUTES_IN_DAY * 60000;
  const nowMs = ref.getTime();
  const noonWibMs = new TZDate(y, mo, d, 12, 0, 0, WIB_TZ).getTime();

  return SESSIONS.map((s) => {
    const segments: SessionSegment[] = [];
    let active = false;

    // Home calendar date around this WIB day (noon anchor dodges DST edges).
    const homeNoon = new TZDate(noonWibMs, s.homeTz);
    for (const off of [-1, 0, 1]) {
      const cand = new TZDate(homeNoon.getTime() + off * 86_400_000, s.homeTz);
      const hy = cand.getFullYear();
      const hmo = cand.getMonth();
      const hdd = cand.getDate();
      const weekday = cand.getDay();

      const rule = s.schedule.find((r) => r.days.includes(weekday));
      if (!rule) continue;

      const startMs = homeWallClockMs(hy, hmo, hdd, rule.start[0], rule.start[1], s.homeTz);
      const endMs = homeWallClockMs(hy, hmo, hdd, rule.end[0], rule.end[1], s.homeTz);

      if (nowMs >= startMs && nowMs < endMs) active = true;

      const clipStart = Math.max(dayStart, startMs);
      const clipEnd = Math.min(dayEnd, endMs);
      if (clipEnd > clipStart) {
        segments.push({
          startMin: (clipStart - dayStart) / 60000,
          endMin: (clipEnd - dayStart) / 60000,
        });
      }
    }

    segments.sort((a, b) => a.startMin - b.startMin);
    return { key: s.key, label: s.label, group: s.group, homeHours: s.homeHours, segments, active };
  });
}
