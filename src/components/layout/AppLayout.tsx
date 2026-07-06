import { useState } from 'react';
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

const deskConfig: Record<DeskId, { label: string; accent: { bg: string; text: string; bgActive: string } }> = {
  forex:  { label: 'Forex & Commodities', accent: { bg: 'rgba(16,185,129,0.1)', text: '#34d399', bgActive: 'rgba(16,185,129,0.15)' } },
  crypto: { label: 'Crypto Desk',         accent: { bg: 'rgba(6,182,212,0.1)',  text: '#22d3ee', bgActive: 'rgba(6,182,212,0.15)' } },
  saham:  { label: 'Equities Desk',       accent: { bg: 'rgba(245,158,11,0.1)', text: '#fbbf24', bgActive: 'rgba(245,158,11,0.15)' } },
};

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row">
      {/* Sidebar */}
      <nav
        className={cn(
          "w-full bg-slate-900 border-b md:border-r border-slate-800 p-4 shrink-0 flex flex-col transition-[width] duration-200 ease-in-out",
          collapsed ? "md:w-16 md:px-2" : "md:w-64"
        )}
      >
        <div className={cn("flex items-center mb-6 mt-2", collapsed ? "md:flex-col md:gap-2 md:px-0 gap-2 px-2" : "gap-2 px-2")}>
          <div className="w-8 h-8 bg-emerald-500 rounded-md flex items-center justify-center font-bold text-slate-950 shrink-0">
            PMS
          </div>
          <h1 className={cn("text-xl font-bold tracking-tight", collapsed && "md:hidden")}>Trading PMS</h1>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex ml-auto items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Overview — unified landing, above the desks */}
        <Link
          to="/overview"
          title={collapsed ? 'Overview' : undefined}
          className={cn(
            "flex items-center gap-3 py-2.5 mb-3 rounded-lg transition-colors font-medium text-sm",
            collapsed ? "md:justify-center md:px-0 px-4" : "px-4",
            overview ? "bg-slate-100/10 text-slate-100" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          )}
        >
          <Globe className="w-5 h-5 shrink-0" />
          <span className={cn(collapsed && "md:hidden")}>Overview</span>
        </Link>

        {/* Desk navigation — admin only. Public visitors see just the Overview. */}
        {isAdmin && (<>
        {/* Desk Switcher — 3 desks */}
        <div className={cn("flex gap-1 p-1 mb-4 bg-slate-950 rounded-lg border border-slate-800", collapsed && "md:flex-col")}>
          <Link
            to="/forex"
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md text-xs font-semibold transition-all",
              !overview && desk === 'forex'
                ? "shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            )}
            style={!overview && desk === 'forex' ? { backgroundColor: deskConfig.forex.accent.bgActive, color: deskConfig.forex.accent.text } : undefined}
            title={collapsed ? 'Forex' : undefined}
          >
            <LineChart className="w-3.5 h-3.5 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Forex</span>
          </Link>
          <Link
            to="/crypto"
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md text-xs font-semibold transition-all",
              !overview && desk === 'crypto'
                ? "shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            )}
            style={!overview && desk === 'crypto' ? { backgroundColor: deskConfig.crypto.accent.bgActive, color: deskConfig.crypto.accent.text } : undefined}
            title={collapsed ? 'Crypto' : undefined}
          >
            <Coins className="w-3.5 h-3.5 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Crypto</span>
          </Link>
          <Link
            to="/saham"
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md text-xs font-semibold transition-all",
              !overview && desk === 'saham'
                ? "shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            )}
            style={!overview && desk === 'saham' ? { backgroundColor: deskConfig.saham.accent.bgActive, color: deskConfig.saham.accent.text } : undefined}
            title={collapsed ? 'Saham' : undefined}
          >
            <Briefcase className="w-3.5 h-3.5 shrink-0" />
            <span className={cn(collapsed && "md:hidden")}>Saham</span>
          </Link>
        </div>

        {/* Desk Label */}
        <p
          className={cn("text-[10px] font-semibold uppercase tracking-widest px-3 mb-2", collapsed && "md:hidden")}
          style={{ color: config.accent.text, opacity: 0.6 }}
        >
          {overview ? 'Consolidated' : config.label}
        </p>

        <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;

            return (
              <li key={item.path} className="shrink-0">
                <Link
                  to={item.path}
                  title={collapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center gap-3 py-2.5 rounded-lg transition-colors font-medium text-sm",
                    collapsed ? "md:justify-center md:px-0 px-4" : "px-4",
                    isActive
                      ? ""
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  )}
                  style={isActive ? {
                    backgroundColor: config.accent.bg,
                    color: config.accent.text,
                  } : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className={cn(collapsed && "md:hidden")}>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        </>)}

        {/* Auth control — pinned to the bottom of the sidebar */}
        <div className="mt-auto pt-4 border-t border-slate-800">
          {isAdmin ? (
            <div className="space-y-2">
              <p className={cn("text-[10px] text-slate-500 px-2 truncate", collapsed && "md:hidden")} title={session?.user?.email ?? ''}>
                Signed in · {session?.user?.email ?? 'admin'}
              </p>
              <button
                onClick={() => signOut()}
                title={collapsed ? 'Sign Out' : undefined}
                className={cn(
                  "w-full flex items-center gap-2 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors",
                  collapsed ? "md:justify-center md:px-0 px-4" : "px-4"
                )}
              >
                <LogOut className="w-4 h-4 shrink-0" /> <span className={cn(collapsed && "md:hidden")}>Sign Out</span>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              title={collapsed ? 'Admin Sign In' : undefined}
              className={cn(
                "w-full flex items-center gap-2 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors",
                collapsed ? "md:justify-center md:px-0 px-4" : "px-4"
              )}
            >
              <LogIn className="w-4 h-4 shrink-0" /> <span className={cn(collapsed && "md:hidden")}>Admin Sign In</span>
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
