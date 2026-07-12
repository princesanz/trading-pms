import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, History, PlusCircle, ArrowRightLeft, Coins, LineChart, Briefcase, BookOpen, Download, Globe, LogIn, LogOut, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthProvider';

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

// `admin: true` marks write/full-detail items — hidden from public visitors.
const forexNav = [
  { name: 'Dashboard', path: '/forex', icon: LayoutDashboard },
  { name: 'New Trade', path: '/trade/new', icon: PlusCircle, admin: true },
  { name: 'Open Positions', path: '/open-positions', icon: TrendingUp },
  { name: 'Journal', path: '/journal', icon: History },
  { name: 'Cash Flow', path: '/cashflow', icon: ArrowRightLeft, admin: true },
  { name: 'Export', path: '/export', icon: Download, admin: true },
];

const cryptoNav = [
  { name: 'Dashboard', path: '/crypto', icon: LayoutDashboard },
  { name: 'Spot Holdings', path: '/crypto/spot', icon: Coins },
  { name: 'New Futures', path: '/crypto/futures/new', icon: PlusCircle, admin: true },
  { name: 'Futures Journal', path: '/crypto/futures/journal', icon: History },
  { name: 'Cash Flow', path: '/crypto/cashflow', icon: ArrowRightLeft, admin: true },
  { name: 'Export', path: '/crypto/export', icon: Download, admin: true },
];

const sahamNav = [
  { name: 'Dashboard', path: '/saham', icon: LayoutDashboard },
  { name: 'New Transaction', path: '/saham/transaction/new', icon: PlusCircle, admin: true },
  { name: 'Portfolio', path: '/saham/portfolio', icon: Briefcase },
  { name: 'History', path: '/saham/history', icon: History },
  { name: 'Dividends', path: '/saham/dividends', icon: BookOpen },
  { name: 'Cash Flow', path: '/saham/cashflow', icon: ArrowRightLeft, admin: true },
  { name: 'Export', path: '/saham/export', icon: Download, admin: true },
];

type DeskId = 'forex' | 'crypto' | 'saham';

// Desk identity mirrors PageHeader's DESK map — same hues, same labels, so the
// rail and the page header always agree. Static class strings (Tailwind JIT).
const deskConfig: Record<DeskId, {
  label: string;
  code: string;
  icon: typeof LineChart;
  text: string;   // desk-hue text
  tick: string;   // desk-hue fill (accent bars, rail)
}> = {
  forex:  { label: 'FOREX · COMMODITIES', code: 'FX', icon: LineChart, text: 'text-adm-desk-forex',  tick: 'bg-adm-desk-forex' },
  crypto: { label: 'CRYPTO DESK',         code: 'CR', icon: Coins,     text: 'text-adm-desk-crypto', tick: 'bg-adm-desk-crypto' },
  saham:  { label: 'EQUITIES · SAHAM',    code: 'EQ', icon: Briefcase, text: 'text-adm-desk-saham',  tick: 'bg-adm-desk-saham' },
};

const deskOrder: DeskId[] = ['forex', 'crypto', 'saham'];
const deskHome: Record<DeskId, string> = { forex: '/forex', crypto: '/crypto', saham: '/saham' };
const deskName: Record<DeskId, string> = { forex: 'Forex', crypto: 'Crypto', saham: 'Saham' };

function getDesk(pathname: string): DeskId {
  if (pathname.startsWith('/saham')) return 'saham';
  if (pathname.startsWith('/crypto')) return 'crypto';
  return 'forex';
}

function isOverview(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/overview');
}

function getNav(desk: DeskId) {
  if (desk === 'saham') return sahamNav;
  if (desk === 'crypto') return cryptoNav;
  return forexNav;
}

/** Session clock, WIB (UTC+7). Raw text swap once a second — never animated. */
function SessionClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const wib = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Jakarta',
  }).format(now);
  return (
    <span className="font-adm-data text-adm-micro text-adm-ink-dim tabular-nums">
      {wib}<span className="text-adm-ink-dim/70"> WIB</span>
    </span>
  );
}

export function AppLayout() {
  const location = useLocation();
  const { isAdmin, session, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const overview = isOverview(location.pathname);
  const desk = getDesk(location.pathname);
  // Public visitors don't see write/full-detail nav items.
  const navItems = overview ? [] : getNav(desk).filter(item => isAdmin || !item.admin);
  const config = deskConfig[desk];

  // Public Overview = the full-bleed gold landing (its own nav/footer) — no app shell.
  // Admins still get the dashboard shell on /overview.
  if (overview && !isAdmin) return <Outlet />;

  return (
    <div className="min-h-screen bg-adm-bg0 text-adm-ink-hi flex flex-col md:flex-row">
      {/* Sidebar — terminal rail on the adm token set */}
      <nav
        className={cn(
          'relative w-full bg-adm-bg1 border-b md:border-b-0 md:border-r border-adm-line shrink-0 flex flex-col',
          'transition-[width] duration-[120ms] ease-in-out',
          collapsed ? 'md:w-14' : 'md:w-60'
        )}
      >
        {/* Desk rail — full-height 2px accent in the active desk hue */}
        <span
          aria-hidden
          className={cn(
            'absolute left-0 top-0 h-0.5 w-full md:h-full md:w-0.5',
            overview ? 'bg-adm-line2' : config.tick
          )}
        />

        {/* Masthead */}
        <div className={cn('flex items-center gap-2 border-b border-adm-line px-3 h-12', collapsed && 'md:justify-center md:px-0')}>
          <div className={cn('min-w-0', collapsed && 'md:hidden')}>
            <p className="font-adm-data text-adm-micro uppercase text-adm-ink-hi truncate">SANZ CAPITAL</p>
            <p className="font-adm-data text-[9px] leading-3 uppercase tracking-[0.14em] text-adm-ink-dim">PORTFOLIO MGMT SYSTEM</p>
          </div>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex ml-auto items-center justify-center w-6 h-6 rounded-adm-sm border border-adm-line text-adm-ink-dim hover:text-adm-ink-hi hover:bg-adm-bg2 transition-colors duration-[120ms] shrink-0"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className={cn('flex md:flex-col md:flex-1 min-w-0 items-center md:items-stretch gap-2 md:gap-0 overflow-x-auto md:overflow-visible px-3 md:px-0 py-2 md:py-0')}>
          {/* Overview — consolidated landing, above the desks */}
          <Link
            to="/overview"
            title={collapsed ? 'Overview' : undefined}
            className={cn(
              'flex items-center gap-2.5 h-8 md:h-9 shrink-0 md:mx-2 md:mt-2 px-2.5 rounded-adm-sm font-adm-data text-adm-micro uppercase transition-colors duration-[120ms]',
              collapsed && 'md:justify-center md:px-0',
              overview
                ? 'bg-adm-bg2 text-adm-ink-hi'
                : 'text-adm-ink-mid hover:text-adm-ink-hi hover:bg-adm-bg2'
            )}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className={cn(collapsed && 'md:hidden')}>Overview</span>
          </Link>

          {/* Desk navigation — admin only. Public visitors see just the Overview. */}
          {isAdmin && (<>
            {/* Desk switcher — collapsed = single active-desk cell (glanceable); switching
                is deferred to expanding the rail. The full FX/CR/EQ strip is expanded-only. */}
            {collapsed && (
              <Link
                to={deskHome[desk]}
                title={deskName[desk]}
                className="relative hidden md:flex md:mx-2 md:mt-3 items-center justify-center h-8 rounded-adm-sm border border-adm-line bg-adm-bg2 transition-colors duration-[120ms]"
              >
                <span aria-hidden className={cn('absolute left-0 top-0 h-full w-0.5', config.tick)} />
                {(() => { const DeskIcon = config.icon; return <DeskIcon className={cn('w-3.5 h-3.5 shrink-0', config.text)} />; })()}
              </Link>
            )}

            {/* Desk switcher — square hairline strip, mono codes, desk-hue tick on the active cell */}
            <div className={cn('flex shrink-0 rounded-adm-sm border border-adm-line divide-x divide-adm-line overflow-hidden md:mx-2 md:mt-3', collapsed && 'md:hidden')}>
              {deskOrder.map((d) => {
                const c = deskConfig[d];
                const active = !overview && desk === d;
                const DeskIcon = c.icon;
                return (
                  <Link
                    key={d}
                    to={deskHome[d]}
                    className={cn(
                      'relative flex-1 flex items-center justify-center gap-1.5 h-8 px-2 font-adm-data text-adm-micro uppercase transition-colors duration-[120ms]',
                      active ? cn('bg-adm-bg2', c.text) : 'text-adm-ink-dim hover:text-adm-ink-mid hover:bg-adm-bg2'
                    )}
                  >
                    {active && <span aria-hidden className={cn('absolute left-0 top-0 h-0.5 w-full', c.tick)} />}
                    <DeskIcon className="w-3 h-3 shrink-0" />
                    <span>{c.code}</span>
                  </Link>
                );
              })}
            </div>

            {/* Desk label — 2px tick + mono label, same grammar as PageHeader */}
            <div className={cn('hidden md:flex items-center gap-2 px-3 mt-4 mb-1.5', collapsed && 'md:hidden')}>
              <span aria-hidden className={cn('h-3 w-0.5', overview ? 'bg-adm-desk-overview' : config.tick)} />
              <p className={cn('font-adm-data text-adm-micro uppercase truncate', overview ? 'text-adm-ink-mid' : config.text)}>
                {overview ? 'CONSOLIDATED' : config.label}
              </p>
            </div>

            <ul className={cn('flex md:flex-col shrink-0 gap-2 md:gap-px', collapsed && 'md:mt-3')}>
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;

                return (
                  <li key={item.path} className="shrink-0">
                    <Link
                      to={item.path}
                      title={collapsed ? item.name : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-2.5 h-8 md:h-7 px-2.5 md:px-3 rounded-adm-sm md:rounded-none font-adm-data text-adm-micro uppercase transition-colors duration-[120ms]',
                        collapsed && 'md:justify-center md:px-0',
                        isActive
                          ? cn('bg-adm-bg2 text-adm-ink-hi md:bg-adm-bg2')
                          : 'text-adm-ink-mid hover:text-adm-ink-hi hover:bg-adm-bg2'
                      )}
                    >
                      {isActive && <span aria-hidden className={cn('absolute left-0 top-0 h-full w-0.5 hidden md:block', config.tick)} />}
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className={cn(collapsed && 'md:hidden')}>{item.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>)}
        </div>

        {/* Session block — status-dot grammar, pinned to the bottom */}
        <div className="mt-auto border-t border-adm-line px-3 py-2.5 space-y-1.5">
          <div className={cn('flex items-center justify-between gap-2', collapsed && 'md:justify-center')}>
            <span className={cn('inline-flex items-center gap-1.5 min-w-0', collapsed && 'md:justify-center')}>
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full shrink-0', isAdmin ? 'bg-adm-up' : 'bg-adm-ink-dim')} />
              <span
                className={cn('font-adm-data text-adm-micro uppercase truncate', isAdmin ? 'text-adm-ink-mid' : 'text-adm-ink-dim', collapsed && 'md:hidden')}
                title={session?.user?.email ?? ''}
              >
                {isAdmin ? (session?.user?.email ?? 'ADMIN') : 'PUBLIC'}
              </span>
            </span>
            <span className={cn('shrink-0', collapsed && 'md:hidden')}><SessionClock /></span>
          </div>
          {isAdmin ? (
            <button
              onClick={() => signOut()}
              title={collapsed ? 'Sign Out' : undefined}
              className={cn(
                'w-full flex items-center gap-2 h-7 px-1 rounded-adm-sm font-adm-data text-adm-micro uppercase text-adm-ink-dim hover:text-adm-ink-hi hover:bg-adm-bg2 transition-colors duration-[120ms]',
                collapsed && 'md:justify-center md:px-0'
              )}
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" /> <span className={cn(collapsed && 'md:hidden')}>Sign Out</span>
            </button>
          ) : (
            <Link
              to="/login"
              title={collapsed ? 'Admin Sign In' : undefined}
              className={cn(
                'w-full flex items-center gap-2 h-7 px-1 rounded-adm-sm font-adm-data text-adm-micro uppercase text-adm-ink-dim hover:text-adm-ink-hi hover:bg-adm-bg2 transition-colors duration-[120ms]',
                collapsed && 'md:justify-center md:px-0'
              )}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" /> <span className={cn(collapsed && 'md:hidden')}>Admin Sign In</span>
            </Link>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
