import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, History, PlusCircle, ArrowRightLeft, Coins, LineChart, Briefcase, BookOpen, Download, Globe, LogIn, LogOut } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthProvider';

// `admin: true` marks write/full-detail items — hidden from public visitors.
const forexNav = [
  { name: 'Dashboard', path: '/forex', icon: LayoutDashboard },
  { name: 'New Trade', path: '/trade/new', icon: PlusCircle, admin: true },
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
      <nav className="w-full md:w-64 bg-slate-900 border-b md:border-r border-slate-800 p-4 shrink-0 flex flex-col">
        <div className="flex items-center gap-2 mb-6 mt-2 px-2">
          <div className="w-8 h-8 bg-emerald-500 rounded-md flex items-center justify-center font-bold text-slate-950">
            PMS
          </div>
          <h1 className="text-xl font-bold tracking-tight">Trading PMS</h1>
        </div>

        {/* Overview — unified landing, above the desks */}
        <Link
          to="/overview"
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 mb-3 rounded-lg transition-colors font-medium text-sm",
            overview ? "bg-slate-100/10 text-slate-100" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          )}
        >
          <Globe className="w-5 h-5" />
          <span>Overview</span>
        </Link>

        {/* Desk navigation — admin only. Public visitors see just the Overview. */}
        {isAdmin && (<>
        {/* Desk Switcher — 3 desks */}
        <div className="flex gap-1 p-1 mb-4 bg-slate-950 rounded-lg border border-slate-800">
          <Link
            to="/forex"
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-md text-xs font-semibold transition-all",
              !overview && desk === 'forex'
                ? "shadow-sm"
                : "text-slate-500 hover:text-slate-300"
            )}
            style={!overview && desk === 'forex' ? { backgroundColor: deskConfig.forex.accent.bgActive, color: deskConfig.forex.accent.text } : undefined}
          >
            <LineChart className="w-3.5 h-3.5" />
            Forex
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
          >
            <Coins className="w-3.5 h-3.5" />
            Crypto
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
          >
            <Briefcase className="w-3.5 h-3.5" />
            Saham
          </Link>
        </div>

        {/* Desk Label */}
        <p
          className="text-[10px] font-semibold uppercase tracking-widest px-3 mb-2"
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
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors font-medium text-sm",
                    isActive
                      ? ""
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  )}
                  style={isActive ? {
                    backgroundColor: config.accent.bg,
                    color: config.accent.text,
                  } : undefined}
                >
                  <Icon className="w-5 h-5" />
                  <span>{item.name}</span>
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
              <p className="text-[10px] text-slate-500 px-2 truncate" title={session?.user?.email ?? ''}>
                Signed in · {session?.user?.email ?? 'admin'}
              </p>
              <button
                onClick={() => signOut()}
                className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            >
              <LogIn className="w-4 h-4" /> Admin Sign In
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
