/**
 * ChartPanel — the ONLY chart entry point in the admin redesign. No page may
 * import a chart library directly.
 *
 * - line / area / bars render through uPlot (canvas). One y-axis, always.
 * - 'alloc' renders a segmented horizontal allocation bar in plain divs
 *   (replaces the old Recharts donuts — approved Phase 0 decision).
 * - Hover: crosshair + a fixed READOUT STRIP above the plot. The readout is
 *   updated by mutating DOM text nodes from uPlot's setCursor hook, so cursor
 *   movement never triggers a React re-render. No floating tooltip, no CSS
 *   transitions.
 *
 * The public gold landing keeps its own Recharts components (frozen); this
 * file is admin-only.
 */
import { useEffect, useMemo, useRef } from 'react';
import type UPlot from 'uplot';
// uPlot's CSS is tiny and lands in the shared CSS chunk (not the JS entry), so
// it stays static. The uPlot JS itself is imported dynamically in the XY effect
// below, so pages that use only the alloc bar (e.g. the Overview) never pull the
// canvas library into their chunk.
import 'uplot/dist/uPlot.min.css';
import { cn } from '../../lib/utils';
import { color } from '../../design/tokens';
import { fmtNum } from '../../design/format';

type Tone = 'up' | 'down' | 'neutral' | 'forex' | 'crypto' | 'saham';

const TONE_STROKE: Record<Tone, string> = {
  up: color.up,
  down: color.down,
  neutral: color.ink.mid,
  forex: color.desk.forex,
  crypto: color.desk.crypto,
  saham: color.desk.saham,
};
/** 12% alpha fills, matching the token fill variants. */
const alpha12 = (hex: string) => `${hex}1F`;

export type ChartSeries = {
  label: string;
  data: (number | null)[];
  tone?: Tone;
};

type XYProps = {
  type: 'line' | 'area' | 'bars';
  /** Unix SECONDS when xKind='time'; otherwise ordinal indices are derived. */
  x: number[];
  series: ChartSeries[];
  xKind?: 'time' | 'category';
  /** Category labels when xKind='category'. */
  xLabels?: string[];
  height?: number;
  title?: string;
  note?: string;
  valueFormat?: (n: number) => string;
  className?: string;
};

type AllocSegment = { label: string; value: number; color: string };
type AllocProps = {
  type: 'alloc';
  segments: AllocSegment[];
  title?: string;
  note?: string;
  valueFormat?: (n: number) => string;
  className?: string;
};

export type ChartPanelProps = XYProps | AllocProps;

const AXIS_FONT = '10px "IBM Plex Mono", monospace';

export function ChartPanel(props: ChartPanelProps) {
  if (props.type === 'alloc') return <AllocBar {...props} />;
  return <XYChart {...props} />;
}

function Panel({ title, note, className, children }: { title?: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-adm border border-adm-line bg-adm-bg1 p-4', className)}>
      {(title || note) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h3 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{title}</h3>}
          {note && <span className="font-adm-data text-adm-micro text-adm-ink-dim">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function XYChart({ type, x, series, xKind = 'time', xLabels, height = 240, title, note, valueFormat = fmtNum, className }: XYProps) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const uRef = useRef<UPlot | null>(null);

  const data = useMemo<UPlot.AlignedData>(
    () => [x, ...series.map(s => s.data)] as UPlot.AlignedData,
    [x, series]
  );

  // (Re)create on structural change; setData on value-only change.
  const structureKey = `${type}|${xKind}|${series.map(s => `${s.label}:${s.tone ?? 'neutral'}`).join(',')}|${height}`;

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    let cancelled = false;
    let inst: UPlot | null = null;
    let ro: ResizeObserver | null = null;

    const readout = readoutRef.current;
    const setReadout = (u: UPlot) => {
      if (!readout) return;
      const idx = u.cursor.idx;
      if (idx == null) {
        readout.textContent = '';
        return;
      }
      const xv = u.data[0][idx];
      const xText = xKind === 'category'
        ? (xLabels?.[idx] ?? String(xv))
        : new Date((xv as number) * 1000).toISOString().slice(0, 10);
      readout.textContent = `${xText}  ${series
        .map((s, i) => {
          const v = u.data[i + 1][idx];
          return `${s.label} ${v == null ? '—' : valueFormat(v as number)}`;
        })
        .join('   ')}`;
    };

    // Dynamic import: the canvas library loads only when an XY chart actually
    // mounts, keeping it out of the chunks of alloc-only pages.
    void (async () => {
      const { default: uPlot } = await import('uplot');
      if (cancelled || !el) return;

      const opts: UPlot.Options = {
        width: el.clientWidth || 600,
        height,
        legend: { show: false },
        cursor: {
          y: false,
          points: { size: 6, width: 1, stroke: color.ink.hi, fill: color.bg1 },
        },
        scales: { x: { time: xKind === 'time' } },
        axes: [
          {
            stroke: color.ink.dim,
            font: AXIS_FONT,
            grid: { show: false },
            ticks: { stroke: color.line, width: 1 },
            ...(xKind === 'category' && xLabels
              ? { values: (_u: UPlot, splits: number[]) => splits.map(v => (Number.isInteger(v) ? xLabels[v] ?? '' : '')) }
              : {}),
          },
          {
            stroke: color.ink.dim,
            font: AXIS_FONT,
            grid: { stroke: color.line, width: 1 },
            ticks: { show: false },
            size: 64,
            values: (_u: UPlot, splits: number[]) => splits.map(v => valueFormat(v)),
          },
        ],
        series: [
          {},
          ...series.map(s => {
            const stroke = TONE_STROKE[s.tone ?? 'neutral'];
            return {
              label: s.label,
              stroke,
              width: 2,
              ...(type === 'area' ? { fill: alpha12(stroke) } : {}),
              ...(type === 'bars'
                ? { fill: alpha12(stroke), width: 1, paths: uPlot.paths.bars!({ size: [0.6, 64] }) }
                : {}),
              points: { show: false },
            } as UPlot.Series;
          }),
        ],
        hooks: { setCursor: [setReadout] },
      };

      inst = new uPlot(opts, data, el);
      uRef.current = inst;

      ro = new ResizeObserver(() => {
        if (el.clientWidth > 0) inst?.setSize({ width: el.clientWidth, height });
      });
      ro.observe(el);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      inst?.destroy();
      uRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only on structural change
  }, [structureKey]);

  useEffect(() => {
    uRef.current?.setData(data);
  }, [data]);

  return (
    <Panel title={title} note={note} className={className}>
      <div ref={readoutRef} className="h-4 truncate font-adm-data text-adm-micro text-adm-ink-mid" />
      <div ref={plotRef} />
    </Panel>
  );
}

/** Segmented horizontal allocation bar — denser and more legible than a donut.
 *  2px gaps between segments (mark-spec spacer); dot + label + share below. */
function AllocBar({ segments, title, note, valueFormat = fmtNum, className }: AllocProps) {
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const shown = segments.filter(s => s.value > 0);
  return (
    <Panel title={title} note={note} className={className}>
      {total <= 0 ? (
        <p className="py-4 text-center font-adm-data text-adm-xs text-adm-ink-dim">Nothing to allocate.</p>
      ) : (
        <>
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-adm-sm" role="img" aria-label={title ?? 'Allocation'}>
            {shown.map(s => (
              <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={`${s.label} ${((s.value / total) * 100).toFixed(1)}%`} />
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {shown.map(s => {
              const pct = (s.value / total) * 100;
              return (
                <li key={s.label} className="flex items-center justify-between gap-3 font-adm-data text-adm-xs">
                  <span className="flex min-w-0 items-center gap-2 text-adm-ink-mid">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="shrink-0 text-adm-ink-hi">
                    {pct.toFixed(1)}% <span className="text-adm-ink-dim">· {valueFormat(s.value)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
