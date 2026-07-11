/**
 * /lab — TEMPORARY Phase 0 review route. Renders every adm component with
 * realistic data so the design system can be approved before any page
 * migrates. Admin-gated, lazy-loaded, linked from nowhere.
 *
 * ▸▸ MUST BE DELETED (route + this file) before Phase 1 ships. ◂◂
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PageHeader, type DeskId } from '../components/adm/PageHeader';
import { StatusBadge, type BadgeKind } from '../components/adm/StatusBadge';
import { MetricStrip, LivePrice } from '../components/adm/MetricStrip';
import { DataTable, type Column } from '../components/adm/DataTable';
import { ChartPanel } from '../components/adm/ChartPanel';
import { CommandBar, type TradeDesk } from '../components/adm/CommandBar';
import { useForexPolling, useForexFeedMeta, useForexPriceMap } from '../state/prices';
import { fmtUsd, fmtSignedUsd } from '../design/format';
import { color } from '../design/tokens';
import { usePortfolioData } from '../hooks/useSupabase';
import { useCryptoData } from '../hooks/useCryptoData';
import { winLossStats, maxDrawdownPct } from '../lib/tradeStats';
import { forexDeskSummary } from '../lib/deskAggregates';

/* ── tradeStats verification block (Phase 0 blocker check) ─────────────────────
 * OLD formulas below are VERBATIM copies of the pre-extraction inline code from
 * Dashboard.tsx (forex) / CryptoDashboard.tsx (crypto) at commit 26bf55d^.
 * They run against the REAL tables (admin session) next to the new lib. */
function oldWinLoss(closedTrades: { net_pnl?: number | null }[]) {
  const wonTrades = closedTrades.filter(t => (t.net_pnl || 0) > 0);
  const lostTrades = closedTrades.filter(t => (t.net_pnl || 0) < 0);
  const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;
  return { winRate, wonCount: wonTrades.length, lostCount: lostTrades.length };
}
function oldMaxDrawdown(closedTrades: { saldo_akun?: number | null }[], seed: number) {
  let peak = seed;
  let maxDrawdown = 0;
  closedTrades.forEach(t => {
    const balance = t.saldo_akun || 0;
    if (balance > peak) peak = balance;
    if (peak > 0) {
      const drawdown = ((peak - balance) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  });
  return maxDrawdown;
}

/* Localizes the 7-vs-27 gap under the CURRENT session: a server-side exact
 * count of trades (all + status='Closed') vs the row count the hook actually
 * fetched. If serverAll == 27 but fetched < 27 → a fetch-layer cap; if
 * serverAll == 7 → RLS is capping the authenticated read (deployed policy ≠
 * repo's all-or-nothing admin_full_access); if all three are 27 → the admin
 * path is sound and the earlier "7" was purely the anon+public-view path. */
function RawCounts({ fetched }: { fetched: number }) {
  const [serverAll, setServerAll] = useState<number | null | undefined>(undefined);
  const [serverClosed, setServerClosed] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await supabase.from('trades').select('*', { count: 'exact', head: true });
      const closed = await supabase.from('trades').select('*', { count: 'exact', head: true }).eq('status', 'Closed');
      if (!alive) return;
      if (all.error || closed.error) setErr(all.error?.message ?? closed.error?.message ?? 'error');
      setServerAll(all.count);
      setServerClosed(closed.count);
    })();
    return () => { alive = false; };
  }, []);

  const cell = (v: number | null | undefined) => (v === undefined ? '…' : v === null ? '—' : String(v));
  return (
    <div className="rounded-adm border border-adm-line2 bg-adm-bg1 p-3">
      <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">raw row-count probe (current session)</p>
      <div className="mt-2 flex flex-wrap gap-6 font-adm-data text-adm-sm text-adm-ink-hi">
        <span>trades fetched by hook: <b>{fetched}</b></span>
        <span>server COUNT(*) trades: <b>{cell(serverAll)}</b></span>
        <span>server COUNT status='Closed': <b>{cell(serverClosed)}</b></span>
      </div>
      {err && <p className="mt-1 font-adm-data text-adm-micro text-adm-down">probe error: {err}</p>}
      <p className="mt-1 font-adm-data text-adm-micro text-adm-ink-dim">expect all three = 27 under admin. fetched &lt; server ⇒ fetch cap; server=7 ⇒ RLS cap.</p>
    </div>
  );
}

/* Prints the live session's auth.uid() — the JWT `sub` claim that RLS's
 * auth.uid() reads server-side — for byte-for-byte comparison against the
 * admin_full_access policy UID. No theory: just shows the actual value. */
const EXPECTED_ADMIN_UID = '022f007f-6498-4e05-b20f-15d4a2f94051';
const EXPECTED_PROJECT_REF = 'fwjufbssfttswflbvjxl';
// Project the APP is configured against (from .env), independent of the browser
// session — the wrong-project session bug turned on exactly this mismatch.
const ACTIVE_PROJECT_REF = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]; }
  catch { return '(unset)'; }
})();
function SessionIdentity() {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(error.message);
      setUid(data.user?.id ?? null);
      setEmail(data.user?.email ?? null);
    });
    return () => { alive = false; };
  }, []);

  const match = uid === EXPECTED_ADMIN_UID;
  return (
    <div className="rounded-adm border border-adm-line2 bg-adm-bg1 p-3">
      <p className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">live session identity (auth.uid = JWT sub)</p>
      <div className="mt-2 space-y-0.5 font-adm-data text-adm-xs">
        <div className="text-adm-ink-mid">
          project: <span className="text-adm-ink-hi select-all">{ACTIVE_PROJECT_REF}</span>{' '}
          {ACTIVE_PROJECT_REF === EXPECTED_PROJECT_REF
            ? <span className="text-adm-up">✓ correct project</span>
            : <span className="text-adm-down">✗ expected {EXPECTED_PROJECT_REF}</span>}
        </div>
        <div className="text-adm-ink-mid">email: <span className="text-adm-ink-hi select-all">{email ?? '—'}</span></div>
        <div className="text-adm-ink-mid">session uid: <span className="text-adm-ink-hi select-all">{uid === undefined ? '…' : uid ?? 'NULL (no session)'}</span> <span className="text-adm-ink-dim">(len {uid?.length ?? 0})</span></div>
        <div className="text-adm-ink-mid">policy uid:&nbsp; <span className="text-adm-ink-hi select-all">{EXPECTED_ADMIN_UID}</span> <span className="text-adm-ink-dim">(len {EXPECTED_ADMIN_UID.length})</span></div>
        <div className="pt-1">
          {uid === undefined ? null : <StatusBadge kind={match ? 'win' : 'loss'} label={match ? 'UID MATCH' : 'UID MISMATCH'} />}
        </div>
      </div>
      {err && <p className="mt-1 font-adm-data text-adm-micro text-adm-down">getUser error: {err}</p>}
    </div>
  );
}

function TradeStatsVerification() {
  const forex = usePortfolioData();
  const crypto = useCryptoData();
  const forexPrices = useForexPriceMap();

  const rows = useMemo(() => {
    const fxClosed = forex.trades.filter(t => t.status === 'Closed');
    const crClosed = crypto.futuresTrades.filter(t => t.status === 'Closed');
    const mk = (desk: string, closed: { net_pnl?: number | null; saldo_akun?: number | null }[], seed: number) => {
      const oldS = { ...oldWinLoss(closed), maxDrawdown: oldMaxDrawdown(closed, seed) };
      const newS = { ...winLossStats(closed), maxDrawdown: maxDrawdownPct(closed, seed) };
      return {
        desk,
        closed: closed.length,
        oldWinRate: oldS.winRate,
        newWinRate: newS.winRate,
        wl: `${newS.wonCount}W/${newS.lostCount}L`,
        oldDd: oldS.maxDrawdown,
        newDd: newS.maxDrawdown,
        match: oldS.winRate === newS.winRate && oldS.maxDrawdown === newS.maxDrawdown && oldS.wonCount === newS.wonCount && oldS.lostCount === newS.lostCount,
      };
    };
    return [
      mk('Forex', fxClosed, forex.settings?.modal_awal || 0),
      mk('Crypto futures', crClosed, crypto.settings?.modal_awal_crypto || 0),
      {
        desk: 'ALL (fx+cr)',
        closed: fxClosed.length + crClosed.length,
        oldWinRate: NaN, newWinRate: NaN, wl: '—', oldDd: NaN, newDd: NaN, match: true,
      },
    ];
  }, [forex.trades, crypto.futuresTrades, forex.settings, crypto.settings]);

  const fxSummary = useMemo(
    () => forexDeskSummary(forex.cashFlows, forex.trades, forexPrices),
    [forex.cashFlows, forex.trades, forexPrices]
  );

  if (forex.loading || crypto.loading) {
    return <p className="font-adm-data text-adm-xs text-adm-ink-dim">Loading real journal data…</p>;
  }
  if (forex.error || crypto.error) {
    return <p className="font-adm-data text-adm-xs text-adm-down">Fetch error: {forex.error ?? crypto.error} (admin session required — raw tables are RLS-gated)</p>;
  }

  return (
    <div className="space-y-2">
      <SessionIdentity />
      <RawCounts fetched={forex.trades.length} />
      <div className="overflow-x-auto rounded-adm border border-adm-line">
        <table className="w-full font-adm-data text-adm-xs">
          <thead>
            <tr className="border-b border-adm-line2 text-left text-adm-micro uppercase text-adm-ink-dim">
              <th className="px-3 py-2">Desk</th>
              <th className="px-3 py-2 text-right">Closed</th>
              <th className="px-3 py-2 text-right">Win rate OLD</th>
              <th className="px-3 py-2 text-right">Win rate NEW</th>
              <th className="px-3 py-2 text-right">W/L</th>
              <th className="px-3 py-2 text-right">MaxDD OLD</th>
              <th className="px-3 py-2 text-right">MaxDD NEW</th>
              <th className="px-3 py-2">Old==New</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.desk} className="border-b border-adm-line text-adm-ink-hi">
                <td className="px-3 py-2 text-adm-ink-mid">{r.desk}</td>
                <td className="px-3 py-2 text-right">{r.closed}</td>
                <td className="px-3 py-2 text-right">{Number.isNaN(r.oldWinRate) ? '—' : `${r.oldWinRate.toFixed(4)}%`}</td>
                <td className="px-3 py-2 text-right">{Number.isNaN(r.newWinRate) ? '—' : `${r.newWinRate.toFixed(4)}%`}</td>
                <td className="px-3 py-2 text-right">{r.wl}</td>
                <td className="px-3 py-2 text-right">{Number.isNaN(r.oldDd) ? '—' : `${r.oldDd.toFixed(4)}%`}</td>
                <td className="px-3 py-2 text-right">{Number.isNaN(r.newDd) ? '—' : `${r.newDd.toFixed(4)}%`}</td>
                <td className="px-3 py-2"><StatusBadge kind={r.match ? 'win' : 'loss'} label={r.match ? 'MATCH' : 'MISMATCH'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-adm-data text-adm-micro text-adm-ink-dim">
        FOREX DESK MARK-TO-MARKET: equity {fmtUsd(fxSummary.equity)} · P&L {fmtSignedUsd(fxSummary.pnl)} (includes live uPnL on open positions — expected to drift from any static baseline while the feed is LIVE)
      </p>
    </div>
  );
}

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

      {/* tradeStats verification — real tables, old-vs-new formulas (Phase 0 blocker) */}
      <section className="space-y-2">
        <h2 className="font-adm-data text-adm-micro uppercase text-adm-ink-dim">tradeStats verification — REAL journal, old inline vs extracted lib</h2>
        <TradeStatsVerification />
      </section>

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
