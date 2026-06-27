import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useReveal } from './goldHooks';

export type AllocSlice = { desk: string; pct: number; equityUsd: number; color: string; desc: string };

export function AllocationGold({ slices, totalAum, reduced }: { slices: AllocSlice[]; totalAum: number; reduced: boolean }) {
  const { ref, shown } = useReveal<HTMLDivElement>(reduced);
  const data = slices.filter(s => s.pct > 0);

  return (
    <section id="allocation" className="bg-ink text-bone border-t border-hairline">
      <div
        ref={ref}
        className="max-w-[1240px] mx-auto px-6 py-20 transition-all duration-700"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(24px)' }}
      >
        <div className="flex items-baseline gap-3 border-b border-hairline pb-3 mb-10">
          <span className="font-data text-xs text-gold">01</span>
          <h2 className="font-data text-xs uppercase tracking-[0.22em] text-bone-dim">Allocation</h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Donut */}
          <div className="relative h-72 md:h-80">
            {data.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data} dataKey="pct" nameKey="desk" innerRadius="64%" outerRadius="92%"
                      paddingAngle={2} stroke="#0B0A08" strokeWidth={2}
                      isAnimationActive={!reduced} animationDuration={900}
                    >
                      {data.map(s => <Cell key={s.desk} fill={s.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#14110C', border: '1px solid rgba(237,232,221,0.14)', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 12, color: '#EDE8DD' }}
                      formatter={(v: any, n: any) => [`${v}%`, n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-data text-[10px] uppercase tracking-[0.18em] text-bone-dim">Total AUM</span>
                  <span className="font-data text-2xl md:text-3xl text-gold" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                    ${Math.round(totalAum).toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-bone-dim font-data text-sm">No allocation yet.</div>
            )}
          </div>

          {/* Legend */}
          <div className="space-y-5">
            {slices.map(s => (
              <div key={s.desk} className="flex items-start justify-between gap-4 border-b border-hairline pb-5">
                <div className="flex items-start gap-3">
                  <span className="mt-1 w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
                  <div>
                    <div className="font-grotesk text-bone" style={{ fontWeight: 500 }}>{s.desk}</div>
                    <div className="font-grotesk text-sm text-bone-dim">{s.desc}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-data text-xl text-bone" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{s.pct}%</div>
                  <div className="font-data text-xs text-bone-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>${Math.round(s.equityUsd).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
