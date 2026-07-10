/**
 * DataTable — the only table in the admin redesign.
 *
 * - Sortable (click header: desc → asc → off), stable against the given order.
 * - ≤ pageSize rows: plain. > pageSize: paginated. > virtualizeOver (100):
 *   virtualized scroll body (@tanstack/react-virtual), pagination off.
 * - Sticky header, hairline dividers, zero cell radius, numeric columns
 *   right-aligned in the mono data face. Row hover is a background swap —
 *   no transition (journals re-render on live ticks in later phases).
 *
 * Built on CSS grid (not <table>) so virtualization can absolutely position
 * rows; table semantics are preserved with ARIA roles.
 */
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../lib/utils';
import { table as tableTokens } from '../../design/tokens';

export type Column<T> = {
  key: string;
  header: string;
  /** Right-aligns and sets the mono data face. */
  numeric?: boolean;
  align?: 'left' | 'right' | 'center';
  /** CSS grid track, e.g. '120px' or 'minmax(0,2fr)'. Default minmax(0,1fr). */
  width?: string;
  /** Value used for sorting; default reads row[key]. Nulls sort last. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Custom cell renderer; default renders String(row[key] ?? '—'). */
  cell?: (row: T) => ReactNode;
};

type Sort = { key: string; dir: 'asc' | 'desc' };

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last regardless of direction sign flip? kept simple + documented
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  pageSize = 50,
  virtualizeOver = tableTokens.virtualizeOver,
  maxHeight = 560,
  density = 'dense',
  onRowClick,
  empty = 'No rows.',
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  defaultSort?: Sort;
  pageSize?: number;
  virtualizeOver?: number;
  /** Scroll height of the virtualized body. */
  maxHeight?: number;
  density?: 'dense' | 'compact';
  onRowClick?: (row: T) => void;
  empty?: string;
  className?: string;
}) {
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rowH = density === 'dense' ? tableTokens.rowHeight : tableTokens.rowHeightCompact;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    const val = col?.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key] as string | number | null);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compare(val(a), val(b)) * dir);
  }, [rows, sort, columns]);

  const virtual = sorted.length > virtualizeOver;
  const paginated = !virtual && sorted.length > pageSize;
  const pageCount = paginated ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = virtual ? sorted : paginated ? sorted.slice(safePage * pageSize, (safePage + 1) * pageSize) : sorted;

  const virtualizer = useVirtualizer({
    count: virtual ? sorted.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 12,
  });

  const gridTemplateColumns = columns.map(c => c.width ?? 'minmax(0,1fr)').join(' ');
  const cellText = density === 'dense' ? 'text-adm-sm' : 'text-adm-xs';

  const onHeaderClick = (key: string) => {
    setPage(0);
    setSort(s => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null));
  };

  const renderRow = (row: T, style?: React.CSSProperties) => (
    <div
      key={rowKey(row)}
      role="row"
      style={{ ...style, gridTemplateColumns, height: rowH }}
      onClick={onRowClick ? () => onRowClick(row) : undefined}
      className={cn(
        'grid w-full items-center border-b border-adm-line bg-adm-bg1 hover:bg-adm-bg2',
        onRowClick && 'cursor-pointer'
      )}
    >
      {columns.map(c => (
        <div
          key={c.key}
          role="cell"
          className={cn(
            'truncate px-3',
            cellText,
            c.numeric ? 'text-right font-adm-data text-adm-ink-hi' : 'font-adm-ui text-adm-ink-mid',
            c.align === 'right' && 'text-right',
            c.align === 'center' && 'text-center'
          )}
        >
          {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
        </div>
      ))}
    </div>
  );

  const header = (
    <div
      role="row"
      style={{ gridTemplateColumns }}
      className="sticky top-0 z-10 grid border-b border-adm-line2 bg-adm-bg1"
    >
      {columns.map(c => {
        const active = sort?.key === c.key;
        return (
          <button
            key={c.key}
            role="columnheader"
            aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
            onClick={() => onHeaderClick(c.key)}
            className={cn(
              'flex items-center gap-1 px-3 py-2 font-adm-data text-adm-micro uppercase',
              c.numeric || c.align === 'right' ? 'justify-end' : c.align === 'center' ? 'justify-center' : 'justify-start',
              active ? 'text-adm-ink-hi' : 'text-adm-ink-dim hover:text-adm-ink-mid'
            )}
          >
            {c.header}
            {active && <span aria-hidden>{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div role="table" className={cn('overflow-hidden rounded-adm border border-adm-line bg-adm-bg1', className)}>
      {sorted.length === 0 ? (
        <>
          {header}
          <div className="px-3 py-8 text-center font-adm-data text-adm-xs text-adm-ink-dim">{empty}</div>
        </>
      ) : virtual ? (
        <div ref={scrollRef} style={{ maxHeight }} className="overflow-y-auto">
          {header}
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(v =>
              renderRow(sorted[v.index], {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${v.start}px)`,
              })
            )}
          </div>
        </div>
      ) : (
        <>
          {header}
          {visible.map(row => renderRow(row))}
          {paginated && (
            <div className="flex items-center justify-between px-3 py-2 font-adm-data text-adm-micro text-adm-ink-dim">
              <span>
                {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} OF {sorted.length}
              </span>
              <span className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="rounded-adm-sm border border-adm-line px-2 py-0.5 text-adm-ink-mid disabled:opacity-40 hover:bg-adm-bg2"
                >
                  PREV
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  className="rounded-adm-sm border border-adm-line px-2 py-0.5 text-adm-ink-mid disabled:opacity-40 hover:bg-adm-bg2"
                >
                  NEXT
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
