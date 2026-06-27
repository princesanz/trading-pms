import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useReveal } from './goldHooks';

export type CurvePoint = { date: string; value: number };

const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;
type RangeKey = typeof RANGES[number];

function cutoff(range: RangeKey, latest: Date): Date {
  const d = new Date(latest);
  switch (range) {
    case '1M': d.setMonth(d.getMonth() - 1); break;
    case '3M': d.setMonth(d.getMonth() - 3); break;
    case '6M': d.setMonth(d.getMonth() - 6); break;
    case 'YTD': return new Date(latest.getFullYear(), 0, 1);
    case '1Y': d.setFullYear(d.getFullYear() - 1); break;
    case 'ALL': return new Date(0);
  }
  return d;
}

export function EquityCurveGold({
  series, totalAum, returnPct, reduced,
}: { series: CurvePoint[]; totalAum: number; returnPct: number; reduced: boolean }) {
  const { ref, shown } = useReveal<HTMLDivElement>(reduced);
  const [range, setRange] = useState<RangeKey>('ALL');

  const data = useMemo(() => {
    if (series.length === 0) return [];
    const latest = new Date(series[series.length - 1].date);
    const from = cutoff(range, latest);
    const f = series.filter(p => new Date(p.date) >= from);
    return f.length >= 2 ? f : series; // keep a usable window if a range is too sparse
  }, [series, range]);

  const hasData = data.length >= 2;

  return (
    <section id="performance" className="bg-ink text-bone border-t border-hairline">
      <div
        ref={ref}
        className="max-w-[1240px] mx-auto px-6 py-20 transition-all duration-700"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(24px)' }}
      >
        <div className="flex items-baseline gap-3 border-b border-hairline pb-3 mb-10">
          <span className="font-data text-xs text-gold">02</span>
          <h2 className="font-data text-xs uppercase tracking-[0.22em] text-bone-dim">Performance</h2>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-6 mb-6">
          <div>
            <div className="font-data text-[10px] uppercase tracking-[0.18em] text-bone-dim">Assets under management</div>
            <div className="font-data text-4xl md:text-5xl text-bone mt-1" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
              ${Math.round(totalAum).toLocaleString()}
            </div>
            <span
              className="inline-flex items-center gap-1 mt-3 font-data text-xs px-2.5 py-1 rounded border"
              style={{ color: returnPct >= 0 ? '#7FB89A' : '#C77B5A', borderColor: returnPct >= 0 ? 'rgba(127,184,154,0.4)' : 'rgba(199,123,90,0.4)' }}
            >
              {returnPct >= 0 ? '▲' : '▼'} {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}% all-time
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {RANGES.map(r => {
              const active = r === range;
              return (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  aria-pressed={active}
                  className={`font-data text-xs px-3 py-1.5 rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${active ? 'bg-gold text-ink border-gold' : 'border-hairline text-bone-dim hover:text-bone hover:border-gold/50'}`}
                  style={active ? { fontWeight: 600 } : undefined}
                >
                  {r}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-ink-2 border border-hairline rounded-lg p-4 md:p-6">
          <div className="h-72 md:h-96">
            {hasData ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 8 }}>
                  <defs>
                    <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#E8D199" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#E8D199" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(237,232,221,0.07)" vertical={false} />
                  <XAxis dataKey="date" hide />
                  <YAxis
                    orientation="right" stroke="#9A938A" width={56}
                    tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#9A938A' }}
                    tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1B1710', border: '1px solid rgba(237,232,221,0.14)', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 12 }}
                    labelStyle={{ color: '#9A938A' }} itemStyle={{ color: '#E8D199' }}
                    labelFormatter={(d) => new Date(d).toLocaleDateString()}
                    formatter={(v: any) => [`$${Math.round(Number(v)).toLocaleString()}`, 'Cumulative P&L']}
                  />
                  <Area
                    type="monotone" dataKey="value" stroke="#E8D199" strokeWidth={2.25}
                    fill="url(#goldFill)" isAnimationActive={!reduced} animationDuration={1100}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-bone-dim font-data text-sm">
                <span>Not enough closed trades yet to plot.</span>
                <span className="text-xs text-bone-dim/70">The curve fills in as positions are closed.</span>
              </div>
            )}
          </div>
          <p className="font-data text-[10px] text-bone-dim mt-3">
            Cumulative realized P&amp;L over time (USD), from closed positions. Mark-to-market equity series coming soon.
          </p>
        </div>
      </div>
    </section>
  );
}
