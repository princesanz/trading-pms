/**
 * StatusBadge — the only status chip in the admin redesign.
 *
 * Square-ish (4px radius), hairline border, dot + ALWAYS a text label:
 * color is never the sole carrier of state. No transitions — badges sit on
 * live-tick paths (feed status flips live→stale on a poll failure).
 */
import { cn } from '../../lib/utils';

export type BadgeKind =
  | 'live' | 'stale' | 'fallback' | 'error' | 'loading'
  | 'open' | 'closed'
  | 'long' | 'short'
  | 'win' | 'loss'
  | 'neutral';

const KIND: Record<BadgeKind, { dot: string; text: string; defaultLabel: string }> = {
  live:     { dot: 'bg-adm-up',       text: 'text-adm-ink-mid', defaultLabel: 'LIVE' },
  stale:    { dot: 'bg-adm-desk-forex', text: 'text-adm-desk-forex', defaultLabel: 'STALE' },
  fallback: { dot: 'bg-adm-desk-forex', text: 'text-adm-desk-forex', defaultLabel: 'FALLBACK' },
  error:    { dot: 'bg-adm-down',     text: 'text-adm-down',    defaultLabel: 'ERROR' },
  loading:  { dot: 'bg-adm-ink-dim',  text: 'text-adm-ink-dim', defaultLabel: 'LOADING' },
  open:     { dot: 'bg-adm-up',       text: 'text-adm-ink-mid', defaultLabel: 'OPEN' },
  closed:   { dot: 'bg-adm-ink-dim',  text: 'text-adm-ink-dim', defaultLabel: 'CLOSED' },
  long:     { dot: 'bg-adm-up',       text: 'text-adm-up',      defaultLabel: 'LONG' },
  short:    { dot: 'bg-adm-down',     text: 'text-adm-down',    defaultLabel: 'SHORT' },
  win:      { dot: 'bg-adm-up',       text: 'text-adm-up',      defaultLabel: 'WIN' },
  loss:     { dot: 'bg-adm-down',     text: 'text-adm-down',    defaultLabel: 'LOSS' },
  neutral:  { dot: 'bg-adm-ink-dim',  text: 'text-adm-ink-dim', defaultLabel: '—' },
};

export function StatusBadge({
  kind,
  label,
  detail,
  title,
  className,
}: {
  kind: BadgeKind;
  /** Overrides the kind's default label text. */
  label?: string;
  /** Dim suffix, e.g. "37s ago". */
  detail?: string;
  title?: string;
  className?: string;
}) {
  const k = KIND[kind];
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-adm-sm border border-adm-line bg-adm-bg1 px-1.5 py-0.5',
        'font-adm-data text-adm-micro uppercase',
        k.text,
        className
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', k.dot)} />
      {label ?? k.defaultLabel}
      {detail && <span className="text-adm-ink-dim normal-case">{detail}</span>}
    </span>
  );
}
