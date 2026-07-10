/**
 * /lab — TEMPORARY Phase 0 review route. Renders every adm component with
 * realistic data so the design system can be approved before any page
 * migrates. Admin-gated, lazy-loaded, linked from nowhere.
 *
 * ▸▸ MUST BE DELETED (route + this file) before Phase 1 ships. ◂◂
 */
import { useMemo, useState } from 'react';
import { PageHeader, type DeskId } from '../components/adm/PageHeader';
import { StatusBadge, type BadgeKind } from '../components/adm/StatusBadge';
import { MetricStrip, LivePrice } from '../components/adm/MetricStrip';
import { DataTable, type Column } from '../components/adm/DataTable';
import { ChartPanel } from '../components/adm/ChartPanel';
import { CommandBar, type TradeDesk } from '../components/adm/CommandBar';
import { useForexPolling, useForexFeedMeta } from '../state/prices';
import { fmtUsd, fmtSignedUsd } from '../design/format';
import { color } from '../design/tokens';

// Deterministic pseudo-random (no Math.random — keeps snapshots comparable).
const rng = (i: number) => {
  const x = Math.sin(i * 999) * 10000;
  return x - Math.floor(x);
};

type DemoTrade = {
  id: number;
  date: string;
  instrument: string;
  side: 'LONG' | 'SHORT';
  lot: number;
  entry: number;
  exit: number;
  pnl: number;
};

const DEMO_TRADES: DemoTrade[] = Array.from({ length: 250 }, (_, i) => {
  const win = rng(i) > 0.45;
  const entry = 3200 + Math.round(rng(i + 1) * 400);
  const move = Math.round(rng(i + 2) * 300) / 10;
  return {
    id: 250 - i,
    date: new Date(Date.UTC(2026, 0, 1) + i * 43_200_000).toISOString().slice(0, 10),
    instrument: i % 7 === 0 ? 'EURUSD' : i % 5 === 0 ? 'US500' : 'XAUUSD',
    side: rng(i + 3) > 0.5 ? 'LONG' : 'SHORT',
    lot: Math.round(rng(i + 4) * 8 + 1) / 100,
    entry,
    exit: win ? entry + move : entry - move,
    pnl: Math.round((win ? 1 : -1) * rng(i + 5) * 18_000) / 100,
  };
});

const CURVE = (() => {
  let bal = 1200;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < 120; i++) {
    bal += (rng(i) - 0.42) * 60;
    x.push(Math.floor(Date.UTC(2026, 0, 1) / 1000) + i * 86_400);
    y.push(Math.round(bal * 100) / 100);
  }
  return { x, y };
})();

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

const TRADE_COLUMNS: Column<DemoTrade>[] = [
  { key: 'id', header: '#', numeric: true, width: '56px' },
  { key: 'date', header: 'Closed', width: '110px', cell: r => <span className="font-adm-data text-adm-ink-mid">{r.date}</span> },
  { key: 'instrument', header: 'Instrument' },
  { key: 'side', header: 'Side', width: '90px', cell: r => <StatusBadge kind={r.side === 'LONG' ? 'long' : 'short'} /> },
  { key: 'lot', header: 'Lot', numeric: true, width: '72px' },
  { key: 'entry', header: 'Entry', numeric: true },
  { key: 'exit', header: 'Exit', numeric: true },
  {
    key: 'pnl', header: 'P&L', numeric: true, width: '120px',
    sortValue: r => r.pnl,
    cell: r => <span className={r.pnl < 0 ? 'text-adm-down' : 'text-adm-up'}>{fmtSignedUsd(r.pnl)}</span>,
  },
];

export function Lab() {
  useForexPolling();
  const feed = useForexFeedMeta();
  const [desk, setDesk] = useState<TradeDesk>('forex');
  const [writeCount, setWriteCount] = useState(0);

  // Simulated write-driven equity (the odometer roll fires ONLY via this button).
  const equity = useMemo(() => 12_480.55 + writeCount * 120.4, [writeCount]);

  const badgeKinds: BadgeKind[] = ['live', 'stale', 'fallback', 'error', 'loading', 'open', 'closed', 'long', 'short', 'win', 'loss', 'neutral'];

  return (
    <div className="min-h-screen space-y-8 bg-adm-bg0 p-6 font-adm-ui text-adm-ink-hi">
      <PageHeader
        desk={desk as DeskId}
        title="Component Lab"
        sub="Phase 0 review route — temporary, delete before Phase 1 ships"
        commandHint
        right={<StatusBadge kind={feed.status === 'live' ? 'live' : feed.status === 'stale' ? 'stale' : feed.status === 'loading' ? 'loading' : 'error'} detail={feed.lastUpdated ? `${Math.max(0, Math.round((Date.now() - feed.lastUpdated) / 1000))}s ago` : undefined} />}
      />

      {/* Desk identity switcher (PageHeader preview) */}
      <div className="flex gap-2">
        {(['forex', 'crypto', 'saham'] as TradeDesk[]).map(d => (
          <button
            key={d}
            onClick={() => setDesk(d)}
            className={`rounded-adm-sm border px-2 py-1 font-adm-data text-adm-micro uppercase ${d === desk ? 'border-adm-line2 text-adm-ink-hi' : 'border-adm-line text-adm-ink-dim hover:text-adm-ink-mid'}`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* MetricStrip: signed P&L tones, write-animated equity, live XAU cell */}
      <section className="space-y-2">
        <h2 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">MetricStrip — signed values, write-roll, live cell</h2>
        <MetricStrip
          items={[
            { label: 'Equity (write-animated)', value: equity, format: 'usd', animateOnWrite: true, emphasis: true, sub: 'rolls ONLY on the simulate-write button' },
            { label: 'Total P&L', value: 1_284.3, format: 'signedUsd', sub: '+12.4% vs modal awal' },
            { label: 'Worst day', value: -152.81, format: 'signedUsd', sub: '2026-07-02' },
            { label: 'Win rate', value: 42.9, format: 'pct', tone: 'neutral', sub: '3W / 4L' },
            { label: 'XAUUSD live', value: <LivePrice source="forex" symbol="XAUUSD" className="text-adm-ink-hi" />, sub: 'ticks with NO animation', format: 'raw' },
          ]}
        />
        <button
          onClick={() => setWriteCount(c => c + 1)}
          className="rounded-adm-sm border border-adm-line px-2 py-1 font-adm-data text-adm-micro uppercase text-adm-ink-mid hover:bg-adm-bg2"
        >
          Simulate write (trade closed)
        </button>
      </section>

      {/* StatusBadge catalogue */}
      <section className="space-y-2">
        <h2 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">StatusBadge — all kinds</h2>
        <div className="flex flex-wrap gap-2">
          {badgeKinds.map(k => <StatusBadge key={k} kind={k} />)}
          <StatusBadge kind="live" detail="12s ago" />
        </div>
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <ChartPanel
          type="area"
          title="Equity curve — 120 days"
          note="uPlot canvas · hover for readout"
          x={CURVE.x}
          series={[{ label: 'EQ', data: CURVE.y, tone: 'up' }]}
          valueFormat={n => fmtUsd(n)}
          className="lg:col-span-2"
        />
        <div className="space-y-4">
          <ChartPanel
            type="bars"
            title="P&L by weekday"
            x={[0, 1, 2, 3, 4]}
            xKind="category"
            xLabels={WEEKDAYS}
            series={[
              { label: 'PROFIT', data: [420.5, 611.2, 130.4, 88, 240.8], tone: 'up' },
              { label: 'LOSS', data: [-120.3, -60.1, -310.9, -45.5, -178.2], tone: 'down' },
            ]}
            valueFormat={n => fmtSignedUsd(n)}
          />
          <ChartPanel
            type="alloc"
            title="Allocation by desk"
            segments={[
              { label: 'Forex & Commodities', value: 9_420, color: color.desk.forex },
              { label: 'Crypto', value: 2_180, color: color.desk.crypto },
              { label: 'Equities (Saham)', value: 880, color: color.desk.saham },
            ]}
            valueFormat={n => fmtUsd(n)}
          />
        </div>
      </section>

      {/* DataTable: 250 rows → virtualized */}
      <section className="space-y-2">
        <h2 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">DataTable — 250 rows, virtualized, sortable</h2>
        <DataTable columns={TRADE_COLUMNS} rows={DEMO_TRADES} rowKey={r => r.id} defaultSort={{ key: 'id', dir: 'desc' }} />
      </section>

      {/* DataTable: small → plain */}
      <section className="space-y-2">
        <h2 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">DataTable — 8 rows, plain</h2>
        <DataTable columns={TRADE_COLUMNS} rows={DEMO_TRADES.slice(0, 8)} rowKey={r => r.id} />
      </section>

      <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">
        Press <kbd className="rounded-[2px] border border-adm-line2 bg-adm-bg2 px-1">N</kbd> for the CommandBar ({desk} scope, dry-run)
      </p>
      <CommandBar desk={desk} />
    </div>
  );
}
