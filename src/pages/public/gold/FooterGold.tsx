import { ArrowUpRight } from 'lucide-react';

export function FooterGold() {
  return (
    <footer className="bg-ink-2 text-bone border-t border-hairline">
      <div className="max-w-[1240px] mx-auto px-6 py-14 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #F0D58C, #C9A86A 70%)' }} aria-hidden />
            <span className="font-display text-2xl tracking-tight text-bone" style={{ fontWeight: 600 }}>SANZ CAPITAL</span>
          </div>
          <div className="mt-4 max-w-lg">
            <p className="font-data text-[13px] text-bone-dim leading-relaxed uppercase tracking-wide">
              <span className="text-gold">SANZ CAPITAL</span> · Where every number tells the truth.<br/>
              Compounding capital with discipline, transparency, and relentless precision — across every market, every cycle, every day.
            </p>
          </div>
        </div>
        <a
          href="#top"
          className="font-data inline-flex items-center gap-2 text-sm text-gold border border-hairline px-4 py-2.5 rounded hover:border-gold transition-colors self-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Back to top <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
    </footer>
  );
}
