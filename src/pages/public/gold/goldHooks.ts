import { useEffect, useRef, useState } from 'react';

/** True when the user prefers reduced motion (animations should be skipped). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(m.matches);
    const h = () => setReduced(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return reduced;
}

/** Count up to `target` once `active`. With reduced motion (or active=false) → final value immediately. */
export function useCountUp(target: number, active: boolean, duration = 1400) {
  const [val, setVal] = useState(active ? 0 : target);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!active) { setVal(target); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setVal(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, active, duration]);
  return val;
}

/**
 * Reveal-on-scroll: returns a ref + `shown` flag. Element fades/translates in once it
 * enters the viewport. With reduced motion, `shown` is true immediately (content visible).
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(reduced: boolean) {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(reduced);
  useEffect(() => {
    if (reduced) { setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return { ref, shown };
}
