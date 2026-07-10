/**
 * PageHeader — carries ALL desk identity in the admin redesign: a 2px tick +
 * uppercase desk label in the desk hue. Nothing else in a page may use the
 * desk color on data. Right slot hosts StatusBadges / actions; the `N`
 * command hint advertises the CommandBar hotkey.
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type DeskId = 'overview' | 'forex' | 'crypto' | 'saham';

const DESK: Record<DeskId, { label: string; tick: string; text: string }> = {
  overview: { label: 'CONSOLIDATED', tick: 'bg-adm-desk-overview', text: 'text-adm-ink-mid' },
  forex:    { label: 'FOREX · COMMODITIES', tick: 'bg-adm-desk-forex', text: 'text-adm-desk-forex' },
  crypto:   { label: 'CRYPTO DESK', tick: 'bg-adm-desk-crypto', text: 'text-adm-desk-crypto' },
  saham:    { label: 'EQUITIES · SAHAM', tick: 'bg-adm-desk-saham', text: 'text-adm-desk-saham' },
};

export function PageHeader({
  desk,
  title,
  sub,
  right,
  commandHint = false,
  className,
}: {
  desk: DeskId;
  title: string;
  /** One line of context under the title (dim, mono). */
  sub?: string;
  /** Badges / actions, right-aligned. */
  right?: ReactNode;
  /** Show the `N — new trade` hotkey hint chip. */
  commandHint?: boolean;
  className?: string;
}) {
  const d = DESK[desk];
  return (
    <header className={cn('flex items-end justify-between gap-4 border-b border-adm-line pb-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn('h-3 w-0.5', d.tick)} />
          <span className={cn('font-adm-data text-adm-micro uppercase', d.text)}>{d.label}</span>
        </div>
        <h1 className="mt-1 font-adm-ui text-adm-xl font-medium text-adm-ink-hi truncate">{title}</h1>
        {sub && <p className="mt-0.5 font-adm-data text-adm-xs text-adm-ink-dim truncate">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        {commandHint && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 rounded-adm-sm border border-adm-line px-1.5 py-0.5 font-adm-data text-adm-micro uppercase text-adm-ink-dim"
            title="Press N for a new trade"
          >
            <kbd className="rounded-[2px] border border-adm-line2 bg-adm-bg2 px-1 font-adm-data text-adm-ink-mid">N</kbd>
            NEW TRADE
          </span>
        )}
      </div>
    </header>
  );
}
