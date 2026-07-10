/**
 * MetricStrip — the bordered metric grid that replaces every card row in the
 * admin redesign. One hairline-divided strip; label / mono value / dim subline
 * per cell. No shadows, no icon boxes.
 *
 * MOTION POLICY (Sanz, Phase 0 correction #1):
 * - `animateOnWrite` cells roll (transform-only) when their value changes as
 *   a result of a DISCRETE WRITE (trade closed, cash-flow entry → new query
 *   data). Suppressed by prefers-reduced-motion (CSS).
 * - LIVE price cells use the separate <LivePrice> component below, which
 *   subscribes to the price store per-symbol and structurally CANNOT animate
 *   — a price tick swaps the number, nothing else. Do not wrap <LivePrice>
 *   in animation.
 *
 * Signed P&L values: pass a number with a `signed*` format — the +/− prefix
 * is mandatory and the up/down tone derives from the sign, so color is never
 * the sole carrier.
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { fmtUsd, fmtIdr, fmtSignedUsd, fmtSignedIdr, fmtSignedPct, fmtPct, fmtPrice, fmtNum } from '../../design/format';
import { useForexPrice, useCryptoPrice, useUsdIdrRate } from '../../state/prices';

export type MetricFormat = 'usd' | 'idr' | 'signedUsd' | 'signedIdr' | 'signedPct' | 'pct' | 'price' | 'num' | 'raw';

const FMT: Record<Exclude<MetricFormat, 'raw'>, (n: number) => string> = {
  usd: fmtUsd,
  idr: fmtIdr,
  signedUsd: fmtSignedUsd,
  signedIdr: fmtSignedIdr,
  signedPct: fmtSignedPct,
  pct: fmtPct,
  price: fmtPrice,
  num: fmtNum,
};

export type MetricItem = {
  label: string;
  /** number → formatted via `format`; ReactNode/string → rendered as-is. */
  value: number | string | ReactNode;
  format?: MetricFormat;
  /** Overrides the sign-derived tone. Only signed* formats derive one. */
  tone?: 'up' | 'down' | 'neutral';
  sub?: string;
  /** Roll-in on value change — WRITE-driven values only, never live prices. */
  animateOnWrite?: boolean;
  /** Larger value type for the headline cell. */
  emphasis?: boolean;
};

function toneOf(item: MetricItem): 'up' | 'down' | 'neutral' {
  if (item.tone) return item.tone;
  if (typeof item.value === 'number' && item.format?.startsWith('signed')) {
    return item.value < 0 ? 'down' : 'up';
  }
  return 'neutral';
}

const TONE_CLASS = { up: 'text-adm-up', down: 'text-adm-down', neutral: 'text-adm-ink-hi' } as const;

/** Transform-only roll on change: remounts the inner span when `changeKey`
 *  changes, replaying the CSS animation (see .adm-roll in index.css). */
function RollOnChange({ changeKey, children }: { changeKey: string; children: ReactNode }) {
  return (
    <span className="inline-block overflow-hidden align-bottom">
      <span key={changeKey} className="adm-roll inline-block">{children}</span>
    </span>
  );
}

export function MetricStrip({ items, className }: { items: MetricItem[]; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-px overflow-hidden rounded-adm border border-adm-line bg-adm-line',
        'grid-cols-2 md:grid-cols-[repeat(var(--adm-cols),minmax(0,1fr))]',
        className
      )}
      style={{ '--adm-cols': Math.min(items.length, 6) } as React.CSSProperties}
    >
      {items.map(item => {
        const text =
          typeof item.value === 'number' && item.format !== 'raw'
            ? FMT[(item.format ?? 'num') as Exclude<MetricFormat, 'raw'>](item.value)
            : item.value;
        const node = (
          <span className={cn('font-adm-data', item.emphasis ? 'text-adm-metric-lg' : 'text-adm-metric', TONE_CLASS[toneOf(item)])}>
            {text}
          </span>
        );
        return (
          <div key={item.label} className="bg-adm-bg1 px-4 py-3 min-w-0">
            <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{item.label}</p>
            <p className="mt-1 truncate">
              {item.animateOnWrite && (typeof text === 'string') ? (
                <RollOnChange changeKey={text}>{node}</RollOnChange>
              ) : (
                node
              )}
            </p>
            {item.sub && <p className="mt-0.5 font-adm-data text-adm-xs text-adm-ink-dim truncate">{item.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * LivePrice — a live-ticking number cell. Subscribes to the price store for
 * ONE symbol, so a tick re-renders exactly this span. Deliberately exposes no
 * animation props (motion policy: ticks never animate).
 */
export function LivePrice({
  source,
  symbol,
  format = 'price',
  placeholder = '—',
  className,
}: {
  source: 'forex' | 'crypto';
  symbol: string;
  format?: Exclude<MetricFormat, 'raw'>;
  placeholder?: string;
  className?: string;
}) {
  const forex = useForexPrice(source === 'forex' ? symbol : '');
  const crypto = useCryptoPrice(source === 'crypto' ? symbol : '');
  const value = source === 'forex' ? forex : crypto;
  return (
    <span className={cn('font-adm-data', className)}>
      {value != null ? FMT[format](value) : placeholder}
    </span>
  );
}

/** Live USD/IDR rate as a plain number span (no animation, per motion policy). */
export function LiveUsdIdr({ className }: { className?: string }) {
  const rate = useUsdIdrRate();
  return <span className={cn('font-adm-data', className)}>{rate.toLocaleString('en-US')}</span>;
}
