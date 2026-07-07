/** Display helpers for the Phase 4 Notion-parity trade fields. */

export function formatTradeId(n?: number | null): string {
  return n != null ? `TRD-${n}` : '—';
}

export function formatUsd(n?: number | null): string {
  return n != null
    ? `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
}

export function formatPct(n?: number | null): string {
  return n != null ? `${Number(n).toFixed(2)}%` : '—';
}

export function formatRr(n?: number | null): string {
  return n != null ? `1:${Number(n).toFixed(2)}` : '—';
}

export function formatNum(n?: number | null): string {
  return n != null ? Number(n).toLocaleString() : '—';
}

export function formatSession(s?: string | null): string {
  return s && s.trim() !== '' ? s : '—';
}
