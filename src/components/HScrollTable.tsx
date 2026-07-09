import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Wrapper for wide, horizontally-scrolling tables.
 *
 * Fixes the "scrollbar is stranded at the bottom of a tall table" problem:
 *  1. WHEEL PAN — a vertical mouse-wheel / trackpad gesture over the table pans it
 *     horizontally when the content overflows. It releases back to normal page scroll at the
 *     left/right edges, so vertical page scrolling is never fully hijacked. Shift+wheel and
 *     native horizontal (trackpad deltaX) also work.
 *  2. STICKY SCROLLBAR — a proxy horizontal scrollbar pinned to the bottom of the scroll
 *     viewport (position: sticky; bottom: 0), synced to the table, so it stays reachable no
 *     matter how far down the page you've scrolled. The table's own (native) horizontal
 *     scrollbar is hidden while the proxy is active to avoid a double scrollbar.
 */
export function HScrollTable({ children, className }: { children: ReactNode; className?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const [contentWidth, setContentWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  // Redirect vertical wheel to horizontal pan, releasing at the edges.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;      // nothing to pan → leave page scroll alone
      const delta = e.deltaY;
      if (!delta) return;                                 // horizontal intent (deltaX/shift) → native handles it
      const atStart = el.scrollLeft <= 0;
      const atEnd = Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth;
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return; // at edge → release to page
      el.scrollLeft += delta;
      if (barRef.current) barRef.current.scrollLeft = el.scrollLeft;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Track content width / overflow state for the proxy scrollbar.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setContentWidth(el.scrollWidth);
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [children]);

  // Keep the real scroller and the proxy scrollbar in sync (guard against feedback loop).
  const onMainScroll = () => {
    if (syncing.current) { syncing.current = false; return; }
    if (barRef.current && scrollRef.current) {
      syncing.current = true;
      barRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  };
  const onBarScroll = () => {
    if (syncing.current) { syncing.current = false; return; }
    if (barRef.current && scrollRef.current) {
      syncing.current = true;
      scrollRef.current.scrollLeft = barRef.current.scrollLeft;
    }
  };

  return (
    <div className={className}>
      <div
        ref={scrollRef}
        onScroll={onMainScroll}
        className={cn(
          'overflow-x-auto rounded-t-xl',
          // Hide the native horizontal scrollbar only when the proxy is active.
          overflowing && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {children}
      </div>
      {overflowing && (
        <div
          ref={barRef}
          onScroll={onBarScroll}
          className="sticky bottom-0 z-10 overflow-x-auto rounded-b-xl bg-slate-900/85 backdrop-blur-sm"
          aria-hidden
        >
          <div style={{ width: contentWidth }} className="h-2.5" />
        </div>
      )}
    </div>
  );
}
