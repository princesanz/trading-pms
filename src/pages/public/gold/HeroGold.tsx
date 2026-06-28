import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowRight } from 'lucide-react';
import { GoldTerrain } from './GoldTerrain';
import { useCountUp } from './goldHooks';

type HeroProps = {
  aum: number;
  returnPct: number;
  winRate: number;
  openCount: number;
  xau: number | null;
  xauUpdated: number | null;
  reduced: boolean;
};

function GoldNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', h, { passive: true });
    h();
    return () => window.removeEventListener('scroll', h);
  }, []);
  const link = 'text-bone-dim hover:text-gold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';
  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-colors ${scrolled ? 'bg-ink/80 backdrop-blur-md border-b border-hairline' : 'bg-transparent'}`}>
      <nav className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="w-5 h-5 rounded-full border border-gold" style={{ background: 'radial-gradient(circle at 35% 30%, #F0D58C, #C9A86A 70%)' }} aria-hidden />
          <span className="font-display text-bone text-lg tracking-tight" style={{ fontWeight: 600 }}>SANZ CAPITAL</span>
        </a>
        <div className="flex items-center gap-7 text-sm font-grotesk">
          <a href="#allocation" className={`hidden sm:inline ${link}`}>Portfolio</a>
          <a href="#track" className={`hidden sm:inline ${link}`}>Track record</a>
          <a href="#performance" className={`hidden sm:inline ${link}`}>Approach</a>
          <Link
            to="/login"
            className="font-data text-xs uppercase tracking-wider text-gold border border-gold/40 px-3 py-1.5 rounded hover:bg-gold hover:text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Admin
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function HeroGold({ aum, returnPct, winRate, openCount, xau, xauUpdated, reduced }: HeroProps) {
  const aumV = useCountUp(aum, !reduced);
  const retV = useCountUp(returnPct, !reduced);
  const winV = useCountUp(winRate, !reduced);
  const openV = useCountUp(openCount, !reduced);

  // Relative "updated Xs ago", refreshed every second from the gold-api last-fetch time.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const updatedLabel = (() => {
    if (xauUpdated == null) return 'connecting…';
    const s = Math.max(0, Math.floor((now - xauUpdated) / 1000));
    if (s < 5) return 'updated just now';
    if (s < 60) return `updated ${s}s ago`;
    return `updated ${Math.floor(s / 60)}m ago`;
  })();

  const stats = [
    { label: 'Total AUM', value: `$${Math.round(aumV).toLocaleString()}`, accent: false },
    { label: 'All-time return', value: `${returnPct >= 0 ? '+' : ''}${retV.toFixed(1)}%`, accent: true },
    { label: 'Win rate', value: `${Math.round(winV)}%`, accent: false },
    { label: 'Open positions', value: `${Math.round(openV)}`, accent: false },
  ];

  return (
    <section id="top" className="relative text-bone min-h-[700px] lg:min-h-screen">
      <GoldTerrain reduced={reduced} />
      <GoldNav />

      {/* Dark overlay on the left for text legibility over the terrain */}
      <div className="absolute inset-0 z-[5] bg-gradient-to-r from-black/60 to-transparent" aria-hidden />

      <div className="relative z-10 max-w-[1240px] mx-auto px-8 lg:px-16 pt-32 md:pt-44 pb-24 min-h-screen flex flex-col justify-center">
        <div className="w-full flex flex-col lg:flex-row gap-16 lg:gap-12 lg:items-center">

          {/* Left Side: Branding — 55% */}
          <div className="lg:w-[55%]">
            <p className="font-data text-xs tracking-[0.32em] text-gold-deep uppercase">
              Family Office
            </p>

            <h1
              className="mt-6 font-display text-5xl lg:text-7xl font-light tracking-[0.06em] leading-none"
              style={{ color: '#F5F0E8' }}
            >
              SANZ CAPITAL
            </h1>

            {/* Thin gold rule */}
            <div className="mt-7 h-px w-2/5 bg-gradient-to-r from-gold to-transparent" aria-hidden />

            <p className="mt-7 font-data text-xs tracking-[0.32em] text-bone-dim uppercase">
              Forex · Commodities · Crypto · Stock Market
            </p>

            <p className="font-data mt-10 flex items-center gap-2 text-xs text-bone-dim">
              <span className="relative flex h-2 w-2">
                {!reduced && <span className="absolute inline-flex h-full w-full rounded-full bg-positive opacity-70 animate-ping" />}
                <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
              </span>
              Live · XAUUSD {xau != null ? xau.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'} · {updatedLabel}
            </p>
          </div>

          {/* Right Side: Vision/Mission — 45% */}
          <div className="lg:w-[45%]">
            <p className="font-display text-lg lg:text-xl font-light leading-relaxed" style={{ color: '#F5F0E8' }}>
              A family office built on radical transparency.
              Every position, every drawdown, every return —
              published in real time across forex, commodities,
              crypto, and global equities.
            </p>

            <p className="mt-6 text-sm text-bone-dim font-grotesk font-light leading-relaxed">
              Institutional discipline. Systematic risk management.
              Multi-asset allocation. Long-term capital compounding.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href="#performance"
                className="font-data inline-flex items-center gap-2 px-6 py-3.5 text-sm rounded text-ink transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                style={{ background: 'linear-gradient(135deg, #F0D58C, #C9A86A)', fontWeight: 600 }}
              >
                View live portfolio <ArrowUpRight className="w-4 h-4" />
              </a>
              <a
                href="#track"
                className="font-data inline-flex items-center gap-2 px-6 py-3.5 text-sm rounded border border-gold/40 text-gold hover:border-gold transition-colors"
              >
                Track record <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Stat strip */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 border-t border-hairline">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`py-7 ${i % 2 !== 0 ? 'border-l border-hairline pl-6' : ''} ${i >= 2 ? 'border-t border-hairline md:border-t-0' : ''} ${i !== 0 && i % 2 === 0 ? 'md:border-l md:border-hairline md:pl-6' : ''} ${i === 1 ? 'md:border-l md:border-hairline md:pl-6' : ''} ${i === 3 ? 'md:border-l md:border-hairline md:pl-6' : ''}`}
            >
              <div className="font-data text-[10px] uppercase tracking-[0.18em] text-bone-dim">{s.label}</div>
              <div
                className={`font-data text-2xl md:text-3xl mt-2 ${s.accent ? 'text-positive' : 'text-bone'}`}
                style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
