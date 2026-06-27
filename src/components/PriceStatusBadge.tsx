import { RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

/** Inline union (not imported from a specific provider) so this badge is shared
 *  across desks — used today by both Crypto and Forex live-price feeds. */
export type PriceStatus = 'loading' | 'live' | 'stale' | 'error';

/**
 * Shared "live · updated Xs ago" / "stale" indicator + manual Refresh button.
 */
export function PriceStatusBadge({
  status,
  lastUpdated,
  onRefresh,
}: {
  status: PriceStatus;
  lastUpdated: number | null;
  onRefresh: () => void;
}) {
  const secs = lastUpdated != null ? Math.max(0, Math.round((Date.now() - lastUpdated) / 1000)) : null;

  const dot =
    status === 'live' ? 'bg-emerald-400'
    : status === 'stale' ? 'bg-amber-400'
    : status === 'error' ? 'bg-rose-400'
    : 'bg-slate-400';

  const label =
    status === 'loading' ? 'Loading prices…'
    : status === 'live' ? `Live${secs != null ? ` · updated ${secs}s ago` : ''}`
    : status === 'stale' ? `Stale${secs != null ? ` · last ${secs}s ago` : ''}`
    : 'Price feed offline';

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-slate-400">
        <span className={cn('w-2 h-2 rounded-full', dot, status === 'live' && 'animate-pulse')} />
        {label}
      </span>
      <button
        onClick={onRefresh}
        title="Refresh live prices"
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 rounded transition-colors"
      >
        <RefreshCw className={cn('w-3 h-3', status === 'loading' && 'animate-spin')} />
        Refresh
      </button>
    </div>
  );
}
