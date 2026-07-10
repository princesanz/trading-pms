/**
 * CommandBar — single-line trade entry, hotkey `n`, pre-scoped to a desk.
 *
 *   XAUUSD sell 0.02 @ 3320 sl 3335 tp 3290 #breakout
 *
 * Parser is deliberately regex-level (per spec, no tokenizer). The component
 * owns parsing + preview only; the actual mutation arrives via `onSubmit`
 * when each desk is migrated (Phases 2–4) — it must reuse that desk's
 * EXISTING insert path (optimistic cache update, background Supabase write).
 * Without `onSubmit` the bar runs as a dry-run parser (Phase 0 /lab).
 *
 * Solid scrim (no backdrop-filter/blur), no transitions, Esc closes,
 * hotkey ignored while any editable element has focus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { StatusBadge } from './StatusBadge';
import type { DeskId } from './PageHeader';

export type TradeDesk = Exclude<DeskId, 'overview'>;

export type ParsedTrade = {
  desk: TradeDesk;
  symbol: string;
  side: 'buy' | 'sell' | 'long' | 'short';
  size: number;
  entry: number;
  sl?: number;
  tp?: number;
  tag?: string;
};

const NUM = '([0-9]*\\.?[0-9]+)';
const CMD_RE = new RegExp(
  `^(\\S+)\\s+(buy|sell|long|short)\\s+${NUM}\\s*@\\s*${NUM}(?:\\s+sl\\s+${NUM})?(?:\\s+tp\\s+${NUM})?(?:\\s+#([\\w-]+))?\\s*$`,
  'i'
);

const DESK_SIDES: Record<TradeDesk, ReadonlyArray<ParsedTrade['side']>> = {
  forex: ['buy', 'sell'],
  crypto: ['long', 'short', 'buy', 'sell'],
  saham: ['buy', 'sell'],
};
const DESK_SIZE_LABEL: Record<TradeDesk, string> = { forex: 'LOT', crypto: 'QTY', saham: 'LOT' };
const DESK_HINT: Record<TradeDesk, string> = {
  forex: 'XAUUSD sell 0.02 @ 3320 sl 3335 tp 3290 #breakout',
  crypto: 'BTCUSDT long 0.05 @ 63500 sl 61800 tp 68000 #trend',
  saham: 'BBCA buy 10 @ 9875 #accum',
};

export function parseTradeCommand(input: string, desk: TradeDesk): { ok: true; trade: ParsedTrade } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '' };
  const m = CMD_RE.exec(trimmed);
  if (!m) return { ok: false, error: `Can't parse. Format: ${DESK_HINT[desk]}` };
  const side = m[2].toLowerCase() as ParsedTrade['side'];
  if (!DESK_SIDES[desk].includes(side)) {
    return { ok: false, error: `'${side}' is not a ${desk} side — use ${DESK_SIDES[desk].join('/')}` };
  }
  const num = (v: string | undefined) => (v == null ? undefined : Number(v));
  const trade: ParsedTrade = {
    desk,
    symbol: m[1].toUpperCase(),
    side,
    size: Number(m[3]),
    entry: Number(m[4]),
    sl: num(m[5]),
    tp: num(m[6]),
    tag: m[7],
  };
  if (trade.size <= 0) return { ok: false, error: 'Size must be > 0' };
  if (trade.entry <= 0) return { ok: false, error: 'Entry must be > 0' };
  return { ok: true, trade };
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function CommandBar({
  desk,
  onSubmit,
  className,
}: {
  desk: TradeDesk;
  /** Wire to the desk's EXISTING insert path. Absent → dry-run preview only. */
  onSubmit?: (trade: ParsedTrade) => Promise<void> | void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setInput('');
    setSubmitError(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) {
        if (e.key === 'Escape') close();
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const parsed = useMemo(() => parseTradeCommand(input, desk), [input, desk]);

  const submit = async () => {
    if (!parsed.ok || busy) return;
    if (!onSubmit) {
      setSubmitError('Dry run — no submit path wired on this desk yet.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(parsed.trade);
      close();
    } catch (e) {
      setBusy(false);
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  const t = parsed.ok ? parsed.trade : null;
  const preview: Array<[string, string]> = [
    ['SYMBOL', t?.symbol ?? '—'],
    ['SIDE', t?.side.toUpperCase() ?? '—'],
    [DESK_SIZE_LABEL[desk], t ? String(t.size) : '—'],
    ['ENTRY', t ? String(t.entry) : '—'],
    ['SL', t?.sl != null ? String(t.sl) : '—'],
    ['TP', t?.tp != null ? String(t.tp) : '—'],
    ['TAG', t?.tag ? `#${t.tag}` : '—'],
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="New trade" className="fixed inset-0 z-50">
      {/* Solid scrim — no blur/backdrop-filter. */}
      <div className="absolute inset-0 bg-[rgba(10,12,14,0.85)]" onClick={close} />
      <div className={cn('absolute left-1/2 top-[18vh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2', className)}>
        <div className="rounded-adm-lg border border-adm-line2 bg-adm-bg1">
          <div className="flex items-center gap-2 border-b border-adm-line px-3 py-2">
            <StatusBadge kind="neutral" label={`NEW ${desk.toUpperCase()} TRADE`} />
            <span className="ml-auto font-adm-data text-adm-micro text-adm-ink-dim">ENTER SUBMIT · ESC CLOSE</span>
          </div>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder={DESK_HINT[desk]}
            spellCheck={false}
            autoComplete="off"
            className="w-full bg-adm-bg0 px-3 py-2.5 font-adm-data text-adm-base text-adm-ink-hi placeholder:text-adm-ink-dim focus:outline-none"
          />
          <div className="grid grid-cols-4 gap-px border-t border-adm-line bg-adm-line md:grid-cols-7">
            {preview.map(([label, value]) => (
              <div key={label} className="bg-adm-bg1 px-2 py-1.5">
                <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">{label}</p>
                <p className="truncate font-adm-data text-adm-xs text-adm-ink-hi">{value}</p>
              </div>
            ))}
          </div>
          {(submitError || (!parsed.ok && parsed.error)) && (
            <p className="border-t border-adm-line px-3 py-1.5 font-adm-data text-adm-micro text-adm-down">
              {submitError ?? (!parsed.ok ? parsed.error : '')}
            </p>
          )}
          {busy && (
            <p className="border-t border-adm-line px-3 py-1.5 font-adm-data text-adm-micro text-adm-ink-dim">Submitting…</p>
          )}
        </div>
      </div>
    </div>
  );
}
