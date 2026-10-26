import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Newspaper, Radio, RefreshCw, SearchX, Tags } from 'lucide-react';
import { formatDistanceStrict } from 'date-fns';
import { useAuth } from '../contexts/AuthProvider';
import { useEconomicCalendar, useFeedSync, useHeadlines } from '../hooks/useNewsTerminal';
import { articleUrl, dayLabel, PAGE_SIZE, shiftDay, TOPICS, WATCHLIST, wibDay, wibTime, type Article, type FeedSync, type Topic } from '../lib/newsTerminal';
import { cn } from '../lib/utils';
import { color } from '../design/tokens';
import './NewsTerminal.css';

const newsStyle = Object.fromEntries(Object.entries({ ...color.news, live: color.status.live, error: color.status.error, neutral: color.status.neutral }).map(([name, value]) => [`--news-${name}`, value])) as CSSProperties;

const control = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-adm-sm border border-adm-line2 px-3 text-adm-xs text-adm-ink-mid hover:bg-adm-bg2 hover:text-adm-ink-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-ink-hi disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-colors motion-safe:duration-[120ms]';
const tabs = [{ id: 'calendar', label: 'Economic Calendar', icon: CalendarDays }, { id: 'macro', label: 'Macro Headlines', icon: Radio }, { id: 'watchlist', label: 'Watchlist News', icon: Tags }] as const;
type Tab = typeof tabs[number]['id'];
function relative(value: string, now: Date) {
  return formatDistanceStrict(new Date(value), now, { addSuffix: true });
}
function State({ title, children, retry }: { title: string; children: ReactNode; retry?: () => void }) {
  return <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 px-6 text-center" role={retry ? 'alert' : 'status'}>
    <SearchX aria-hidden className="h-5 w-5 text-adm-ink-dim" />
    <p className="text-adm-base text-adm-ink-hi">{title}</p>
    <div className="max-w-md text-adm-sm text-adm-ink-mid">{children}</div>
    {retry && <button className={control} onClick={retry}>Try again</button>}
  </div>;
}
function Skeleton() {
  return <div role="status" aria-label="Loading terminal data" className="divide-y divide-adm-line">
    {Array.from({ length: 8 }, (_, i) => <div key={i} aria-hidden className="h-24 space-y-3 px-4 py-5"><div className="h-3 w-28 bg-adm-bg2" /><div className="h-4 w-3/4 bg-adm-bg2" /></div>)}
  </div>;
}
function SyncStatus({ rows, sources, now, loading, failed }: { rows: FeedSync[]; sources: string[]; now: Date; loading: boolean; failed: boolean }) {
  return <div className="flex h-20 flex-wrap content-center gap-x-5 gap-y-1 overflow-auto border-b border-adm-line px-4 font-adm-data text-adm-micro tabular-nums" aria-label="Feed synchronization status">
    {failed ? <span role="status">Sync status unavailable; headlines may be cached.</span> : sources.map(source => {
      const row = rows.find(item => item.source === source);
      const stale = row?.last_success && now.getTime() - Date.parse(row.last_success) > 30 * 60_000;
      const state = row?.status === 'success' && stale ? 'stale' : row?.status ?? 'never_run';
      return <div key={source} className="news-sync flex flex-wrap items-center gap-x-2" data-state={state} title={`Feed status: ${state.replace('_', ' ')}`}>
        <span className="news-sync-dot" aria-hidden />
        <span className="news-sync-label uppercase text-adm-ink-mid">{source.replace('yahoo:', '')}</span>
        <span className="text-adm-ink-dim">{loading ? 'Checking…' : !row ? 'Not configured' : row.last_success ? `Last synced ${relative(row.last_success, now)}` : 'Never synced'}</span>
        {row && (row.status !== 'success' || stale) && <span className="news-sync-badge border border-adm-line2 px-1 uppercase">{row.status !== 'success' ? row.status.replace('_', ' ') : 'Over 30m old'}</span>}
      </div>;
    })}
  </div>;
}
function CalendarPanel({ userId, now }: { userId: string; now: Date }) {
  const [day, setDay] = useState(() => wibDay(new Date()));
  const query = useEconomicCalendar(userId, day);
  const rows = query.data ?? [];
  return <>
    <div className="flex h-16 items-center gap-2 border-b border-adm-line px-3">
      <button className={control} aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}><ChevronLeft size={14} /></button>
      <label className="sr-only" htmlFor="news-date">Calendar date in WIB</label>
      <input id="news-date" type="date" value={day} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value); }} className="min-w-0 rounded-adm-sm border border-adm-line2 bg-adm-bg0 px-2 py-2 font-adm-data text-adm-xs tabular-nums [color-scheme:dark]" />
      <button className={control} aria-label="Next day" onClick={() => setDay(shiftDay(day, 1))}><ChevronRight size={14} /></button>
      <button className={cn(control, 'ml-auto')} onClick={() => setDay(wibDay(now))}>Today</button>
    </div>
    <div className="h-[480px] overflow-auto [scrollbar-gutter:stable]" aria-busy={query.isFetching}>
      {query.isPending ? <Skeleton /> : query.isError && !query.data ? <State title="Calendar unavailable" retry={() => void query.refetch()}>Please check your connection and try again.</State> : rows.length === 0 ? <State title="No scheduled events">No events were received for {dayLabel(day)}. This feed covers the current week only.</State> : <>
        <h2 className="news-date sticky top-0 z-10 border-b border-adm-line bg-adm-bg2 px-4 py-3 font-adm-data text-adm-xs">{dayLabel(day)} · WIB / UTC+7</h2>
        <table className="w-full min-w-[650px] table-fixed text-left text-adm-sm">
          <caption className="sr-only">Economic calendar for {dayLabel(day)}. Actual values are not supplied.</caption>
          <thead className="text-adm-ink-dim"><tr>{['Time', 'Currency', 'Event / Impact', 'Forecast', 'Previous'].map((label, i) => <th key={label} scope="col" className={cn('border-b border-adm-line px-4 py-3 font-normal', i === 2 ? 'w-[38%]' : 'w-[15.5%]')}>{label}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 100).map(event => <tr key={event.id} className="border-b border-adm-line align-top hover:bg-adm-bg2">
            <td className="px-4 py-3 font-adm-data text-adm-xs tabular-nums"><time dateTime={event.event_time}>{wibTime(event.event_time)}</time></td>
            <td className="news-currency px-4 py-3 font-adm-data text-adm-xs">{event.currency}</td>
            <td className="px-4 py-3"><p className="break-words">{event.title}</p><div className="mt-2 flex flex-wrap items-center gap-2"><span data-impact={event.impact} className="news-impact rounded-adm-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider">{event.impact}</span><span className="text-adm-xs text-adm-ink-dim">{Date.parse(event.event_time) > now.getTime() ? relative(event.event_time, now) : 'Scheduled time passed'}</span></div></td>
            <td className="break-words px-4 py-3 font-adm-data text-adm-xs tabular-nums">{event.forecast ?? '—'}</td><td className="break-words px-4 py-3 font-adm-data text-adm-xs tabular-nums">{event.previous ?? '—'}</td>
          </tr>)}</tbody>
        </table>
      </>}
    </div>
    <div className="flex h-16 items-center border-t border-adm-line px-4 text-adm-xs text-adm-ink-dim" role="status">{query.isError && query.data ? 'Refresh failed. Showing previously loaded events.' : rows.length > 100 ? 'Showing the first 100 events for this day.' : 'Actuals are not supplied by this feed. No release results or surprise scores are shown.'}</div>
  </>;
}
function ArticleRow({ article, now }: { article: Article; now: Date }) {
  const href = articleUrl(article.url);
  return <li className="news-article border-b border-adm-line px-4 py-4 hover:bg-adm-bg2" data-category={article.topics[0]}>
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-adm-data text-adm-micro text-adm-ink-dim tabular-nums">
      <span className="news-publisher uppercase text-adm-ink-mid">{article.publisher || article.source}</span>
      <time dateTime={article.published_at ?? article.first_seen_at} title={new Date(article.published_at ?? article.first_seen_at).toISOString()}>{article.published_at ? relative(article.published_at, now) : `Publication time unavailable · first seen ${relative(article.first_seen_at, now)}`}</time>
    </div>
    <h3 className="break-words text-adm-base leading-6">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-ink-hi">{article.title}<ExternalLink aria-hidden size={12} className="ml-2 inline text-adm-ink-dim" /><span className="sr-only"> (opens in a new tab)</span></a> : article.title}</h3>
    {(article.tickers.length > 0 || article.topics.length > 0) && <div className="mt-2 flex flex-wrap gap-1.5">{article.tickers.map(ticker => <span key={ticker} data-ticker={ticker} className="news-ticker rounded-adm-sm border border-adm-line2 px-1.5 font-adm-data text-adm-micro">{ticker}</span>)}{article.topics.map(topic => <span key={topic} data-topic={topic} className="news-topic px-1 text-adm-xs text-adm-ink-dim">{topic.replaceAll('_', ' ')}</span>)}</div>}
  </li>;
}
function HeadlinesPanel({ userId, mode, now, ticker, setTicker }: { userId: string; mode: 'macro' | 'watchlist'; now: Date; ticker: string; setTicker: (value: string) => void }) {
  const [topic, setTopic] = useState<Topic>('All');
  const [page, setPage] = useState(0);
  const [snapshot, setSnapshot] = useState(() => new Date().toISOString());
  const scroll = useRef<HTMLDivElement>(null);
  const filters = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = filters.current;
    if (!container) return;
    const revealSelection = () => {
      const selected = container.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return;
      const bounds = selected.getBoundingClientRect();
      container.scrollLeft += bounds.left - container.getBoundingClientRect().left - (container.clientWidth - bounds.width) / 2;
    };
    const observer = new ResizeObserver(revealSelection);
    observer.observe(container);
    revealSelection();
    return () => observer.disconnect();
  }, [topic, ticker]);
  useEffect(() => {
    if (page !== 0) return;
    const timer = window.setInterval(() => { if (!document.hidden) setSnapshot(new Date().toISOString()); }, 60_000);
    return () => window.clearInterval(timer);
  }, [page]);
  const query = useHeadlines(userId, mode, topic, ticker, page, snapshot);
  const rows = query.data ?? [];
  const changePage = (next: number) => { setPage(next); scroll.current?.scrollTo({ top: 0 }); };
  const refresh = () => { setPage(0); setSnapshot(new Date().toISOString()); };
  return <>
    <div ref={filters} className="flex h-16 items-center gap-2 overflow-x-auto border-b border-adm-line px-3" aria-label={mode === 'macro' ? 'Topic filters' : 'Watchlist filters'}>
      {(mode === 'macro' ? Object.keys(TOPICS) : ['All', ...WATCHLIST]).map(filter => <button key={filter} data-filter={filter} aria-pressed={(mode === 'macro' ? topic : ticker) === filter} className={cn(control, 'news-filter shrink-0')} onClick={() => { if (mode === 'macro') setTopic(filter as Topic); else setTicker(filter); refresh(); }}>{filter}</button>)}
    </div>
    <div ref={scroll} className="h-[480px] overflow-auto [scrollbar-gutter:stable]" aria-busy={query.isFetching}>
      {query.isPending ? <Skeleton /> : query.isError && !query.data ? <State title="Headlines unavailable" retry={() => void query.refetch()}>Please check your connection and try again.</State> : rows.length === 0 ? <State title="No matching headlines">No articles have been ingested for this selection. Tags depend on upstream coverage; an empty result does not imply no market activity.</State> : <ul aria-label="Headlines, newest publication first">{rows.slice(0, PAGE_SIZE).map(article => <ArticleRow key={article.id} article={article} now={now} />)}</ul>}
    </div>
    <div className="flex h-16 items-center justify-between gap-2 border-t border-adm-line px-3">
      <button className={control} onClick={refresh} disabled={query.isFetching}><RefreshCw size={13} aria-hidden />Latest</button>
      <span className="text-adm-xs text-adm-ink-dim" role="status">{query.isError && query.data ? 'Refresh failed · cached' : `Page ${page + 1}`}</span>
      <div className="flex gap-1"><button className={control} aria-label="Previous headlines" disabled={page === 0 || query.isFetching} onClick={() => changePage(page - 1)}><ChevronLeft size={14} /></button><button className={control} aria-label="Older headlines" disabled={rows.length <= PAGE_SIZE || query.isFetching} onClick={() => changePage(page + 1)}><ChevronRight size={14} /></button></div>
    </div>
  </>;
}
function Terminal({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [ticker, setTicker] = useState('All');
  const [now, setNow] = useState(() => new Date());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sync = useFeedSync(userId);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const sources = tab === 'calendar' ? ['forexfactory'] : tab === 'macro' ? ['marketwatch', 'cnbc'] : ticker === 'All' ? WATCHLIST.map(value => `yahoo:${value}`) : [ticker === 'BTC' && sync.data?.some(row => row.source === 'yahoo:BTC-USD') ? 'yahoo:BTC-USD' : `yahoo:${ticker}`];
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(tabs[next].id); tabRefs.current[next]?.focus();
  }
  return <section className="news-terminal min-w-0 font-adm-ui text-adm-ink-hi" data-tab={tab} style={newsStyle}>
    <header className="mb-6"><p className="news-eyebrow mb-2 flex items-center gap-2 font-adm-data text-adm-micro uppercase text-adm-ink-dim"><span className="news-header-icon"><Newspaper size={15} aria-hidden /></span>Global desk · Research</p><h1 className="text-adm-xl font-medium">News & Macro Terminal</h1><p className="mt-1 text-adm-sm text-adm-ink-mid">Economic schedule, macro context and company news.</p></header>
    <div className="news-panel overflow-hidden rounded-adm border border-adm-line2 bg-adm-bg1">
      <div role="tablist" aria-label="News terminal" className="grid h-16 grid-cols-3 border-b border-adm-line sm:flex sm:h-14">
        {tabs.map((item, index) => <button key={item.id} ref={el => { tabRefs.current[index] = el; }} id={`news-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`news-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={event => navigateTabs(event, index)} onClick={() => setTab(item.id)} className={cn('min-w-0 shrink-0 border-b-2 px-2 text-adm-xs sm:px-4 sm:text-adm-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-adm-ink-hi motion-safe:transition-colors motion-safe:duration-[120ms]', tab === item.id ? 'border-adm-ink-hi bg-adm-bg2 text-adm-ink-hi' : 'border-transparent text-adm-ink-dim hover:text-adm-ink-hi')}><item.icon size={15} className="news-tab-icon" aria-hidden />{item.label}</button>)}
      </div>
      <SyncStatus rows={sync.data ?? []} sources={sources} now={now} loading={sync.isPending} failed={sync.isError} />
      <div id={`news-panel-${tab}`} role="tabpanel" aria-labelledby={`news-tab-${tab}`} tabIndex={0}>
        {tab === 'calendar' ? <CalendarPanel userId={userId} now={now} /> : <HeadlinesPanel key={tab} userId={userId} mode={tab} now={now} ticker={ticker} setTicker={setTicker} />}
      </div>
    </div>
    <p className="mt-3 flex items-start gap-2 text-adm-xs text-adm-ink-dim"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />WIB (UTC+7). Feed delivery is delayed; this is not an execution feed. Latest headlines refresh every minute while visible. Rates includes bonds and monetary policy; Equities includes earnings tags. XAU/BTC coverage requires a configured upstream feed.</p>
  </section>;
}
export function NewsTerminal() {
  const { session, loading } = useAuth();
  if (loading) return <div className="h-[760px] rounded-adm border border-adm-line bg-adm-bg1"><Skeleton /></div>;
  if (!session) return <State title="Sign in to open News Terminal">This research feed requires an authenticated session.<div className="mt-4"><Link className={control} to="/login" state={{ from: '/news' }}>Sign in</Link></div></State>;
  return <Terminal key={session.user.id} userId={session.user.id} />;
}
