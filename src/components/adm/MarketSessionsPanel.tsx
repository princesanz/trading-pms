/**
 * MarketSessionsPanel — a 24-hour WIB schedule strip for the admin Overview.
 *
 * A Gantt-style row per trading session (Sydney/Tokyo/London/NY FX, IDX sesi
 * 1+2, US pre-market + regular), drawn as absolutely-positioned bars over a
 * shared 00:00–24:00 WIB axis with 3-hour gridlines and a live "now" marker.
 * Crypto is intentionally absent (24/7, no official sessions).
 *
 * All session math lives in ../../lib/marketSessions (pure, tz-correct via
 * @date-fns/tz). This file is presentation only — it recomputes windows off a
 * clock that ticks every 30s, so bars flip active/inactive and the now-line
 * advances without ever calling Date.now() during render (react-hooks/purity).
 *
 * This is a schedule visualization, not a data chart — deliberately NOT built
 * on ChartPanel/uPlot (per redesign chart-boundary rules those are for series
 * data). It reuses the adm panel shell + tokens so it reads as one system.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getSessionWindows,
  wibMinutesOfDay,
  wibClockLabel,
  isWibWeekend,
  MINUTES_IN_DAY,
  type SessionGroup,
} from '../../lib/marketSessions';
import { color } from '../../design/tokens';

/** 3 hue groups, from the adm desk token set. */
const GROUP_HUE: Record<SessionGroup, string> = {
  forex: color.desk.forex, // gold
  idx: color.desk.saham,   // violet (Indonesian equities)
  us: color.desk.crypto,   // cyan
};
const GROUP_LABEL: Record<SessionGroup, string> = { forex: 'Forex', idx: 'IDX', us: 'US equities' };

const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const LABEL_W = 116; // px — fits "US regular hours" at the micro mono size
const ROW_H = 24;    // px per row; bar is inset within it (~20px tall)
const pct = (min: number) => `${(min / MINUTES_IN_DAY) * 100}%`;

export function MarketSessionsPanel({ className }: { className?: string }) {
  // Ticking clock: init once (lazy — not a render-time Date.now call), then
  // advance every 30s. Cleared on unmount. Drives active-state + now-line.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const windows = useMemo(() => getSessionWindows(now), [now]);
  const nowMin = wibMinutesOfDay(now);
  const nowPct = (nowMin / MINUTES_IN_DAY) * 100;
  const weekend = isWibWeekend(now);

  return (
    <section className={`rounded-adm border border-adm-line bg-adm-bg1 p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">Market sessions</h3>
        <span className="font-adm-data text-adm-micro text-adm-ink-dim">
          24h · WIB (Asia/Jakarta){weekend ? ' · weekend — markets closed' : ''}
        </span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {(Object.keys(GROUP_HUE) as SessionGroup[]).map((g) => (
          <span key={g} className="flex items-center gap-1.5 font-adm-data text-adm-micro text-adm-ink-mid">
            <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: GROUP_HUE[g] }} />
            {GROUP_LABEL[g]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 font-adm-data text-adm-micro text-adm-ink-dim">
          <span aria-hidden className="inline-block h-3 w-px" style={{ backgroundColor: color.ink.hi }} />
          now {wibClockLabel(now)} WIB
        </span>
      </div>

      {/* Axis labels */}
      <div className="flex">
        <div style={{ width: LABEL_W }} className="shrink-0" />
        <div className="relative h-4 flex-1">
          {HOUR_TICKS.map((h) => (
            <span
              key={h}
              className="absolute top-0 font-adm-data text-[10px] leading-none text-adm-ink-dim"
              style={{ left: pct(h * 60), transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>

      {/* Rows (gap-0 so gridlines + now-line read as continuous verticals) */}
      <div className="mt-1">
        {windows.map((w) => {
          const hue = GROUP_HUE[w.group];
          return (
            <div key={w.key} className="flex items-center" style={{ height: ROW_H }}>
              <div
                style={{ width: LABEL_W }}
                className={`shrink-0 truncate pr-2 font-adm-data text-[10px] ${w.active ? 'text-adm-ink-hi' : 'text-adm-ink-dim'}`}
                title={w.homeHours}
              >
                {w.label}
              </div>
              <div
                className="relative h-full flex-1 border-l border-adm-line"
                role="img"
                aria-label={`${w.label}: ${w.active ? 'active' : 'inactive'}, ${w.homeHours}`}
              >
                {/* gridlines */}
                {HOUR_TICKS.map((h) => (
                  <span key={h} aria-hidden className="absolute top-0 bottom-0 w-px" style={{ left: pct(h * 60), backgroundColor: color.line }} />
                ))}
                {/* session bars */}
                {w.segments.map((seg, i) => (
                  <div
                    key={i}
                    className="absolute rounded-[3px]"
                    style={{
                      left: pct(seg.startMin),
                      width: pct(seg.endMin - seg.startMin),
                      top: 2,
                      bottom: 2,
                      backgroundColor: hue,
                      opacity: w.active ? 1 : 0.35,
                    }}
                    title={`${w.label} · ${w.homeHours}${w.active ? ' · active now' : ''}`}
                  />
                ))}
                {/* now marker (repeated per row → continuous vertical line) */}
                <span aria-hidden className="absolute top-0 bottom-0 w-px" style={{ left: `${nowPct}%`, backgroundColor: color.ink.hi }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Public holidays are out of scope: no holiday calendar is modeled, so a
          bar still renders on an exchange holiday. Weekend closure IS handled. */}
    </section>
  );
}
