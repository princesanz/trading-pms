import { useMemo, useState } from 'react';
import { useReveal } from './goldHooks';

export type TrackCategory = 'forex' | 'crypto' | 'stock';

export type TrackRow = {
  inst: string;
  desk: string;
  side: 'LONG' | 'SHORT' | 'SELL';
  entry: string;
  exit: string;
  pnl: number | null;
  date: string;
  category: TrackCategory;
};

const TABS = [
  { key: 'ALL', label: 'ALL', cat: null },
  { key: 'FOREX', label: 'FOREX', cat: 'forex' },
  { key: 'CRYPTO', label: 'CRYPTO', cat: 'crypto' },
  { key: 'STOCKS', label: 'STOCKS', cat: 'stock' },
] as const;

type TabKey = typeof TABS[number]['key'];

// Per-category empty states.
const EMPTY_MSG: Record<TabKey, string> = {
  ALL: 'No closed trades yet.',
  FOREX: 'No closed forex trades yet.',
  CRYPTO: 'No closed crypto trades yet.',
  STOCKS: 'No closed stock trades yet.',
};

function SideBadge({ side }: { side: TrackRow['side'] }) {
  const color = side === 'SHORT' ? '#C77B5A' : side === 'SELL' ? '#9A938A' : '#7FB89A';
  return (
    <span className="font-data text-[10px] tracking-wider px-2 py-0.5 rounded border" style={{ color, borderColor: `${color}55` }}>
      {side}
    </span>
  );
}

export function TrackRecordGold({ rows, reduced }: { rows: TrackRow[]; reduced: boolean }) {
  const { ref, shown } = useReveal<HTMLDivElement>(reduced);
  const [tab, setTab] = useState<TabKey>('ALL');

  // Client-side: filter the once-fetched rows by category, then cap the view.
  const filtered = useMemo(() => {
    const cat = TABS.find(t => t.key === tab)?.cat ?? null;
    const list = cat ? rows.filter(r => r.category === cat) : rows;
    return list.slice(0, 12);
  }, [rows, tab]);

  return (
    <section id="track" className="bg-ink text-bone border-t border-hairline">
      <div
        ref={ref}
        className="max-w-[1240px] mx-auto px-6 py-20 transition-all duration-700"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(24px)' }}
      >
        <div className="flex items-baseline gap-3 border-b border-hairline pb-3 mb-10">
          <span className="font-data text-xs text-gold">03</span>
          <h2 className="font-data text-xs uppercase tracking-[0.22em] text-bone-dim">Track record — recent closed</h2>
        </div>

        {/* Category filter tabs — same styling as the Performance timeframe buttons. */}
        <div className="flex flex-wrap gap-1 mb-8">
          {TABS.map(t => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-pressed={active}
                className={`font-data text-xs px-3 py-1.5 rounded border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${active ? 'bg-gold text-ink border-gold' : 'border-hairline text-bone-dim hover:text-bone hover:border-gold/50'}`}
                style={active ? { fontWeight: 600 } : undefined}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="font-data text-sm text-bone-dim py-8 text-center border-t border-hairline">{EMPTY_MSG[tab]}</div>
        ) : (
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full text-left min-w-[680px]">
              <thead>
                <tr className="font-data text-[10px] uppercase tracking-[0.16em] text-bone-dim">
                  <th className="py-3 pr-4">Instrument</th>
                  <th className="py-3 pr-4">Desk</th>
                  <th className="py-3 pr-4">Side</th>
                  <th className="py-3 pr-4 text-right">Entry</th>
                  <th className="py-3 pr-4 text-right">Exit</th>
                  <th className="py-3 pr-4 text-right">Net P&L</th>
                  <th className="py-3 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-t border-hairline hover:bg-ink-2/60 transition-colors">
                    <td className="font-data py-3.5 pr-4 text-bone" style={{ fontWeight: 500 }}>{r.inst}</td>
                    <td className="font-grotesk py-3.5 pr-4 text-sm text-bone-dim">{r.desk}</td>
                    <td className="py-3.5 pr-4"><SideBadge side={r.side} /></td>
                    <td className="font-data py-3.5 pr-4 text-right text-bone-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.entry}</td>
                    <td className="font-data py-3.5 pr-4 text-right text-bone-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.exit}</td>
                    <td className="font-data py-3.5 pr-4 text-right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.pnl == null ? '#9A938A' : r.pnl >= 0 ? '#7FB89A' : '#C77B5A' }}>
                      {r.pnl == null ? '—' : `${r.pnl >= 0 ? '+' : '−'}$${Math.abs(r.pnl).toLocaleString()}`}
                    </td>
                    <td className="font-data py-3.5 text-right text-bone-dim" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
