import {
  Activity,
  LayoutDashboard,
  ListTree,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Wallet,
} from 'lucide-react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useData } from '../lib/dataContext';
import { fmtRelativeTime } from '../lib/format';
import { useTheme } from '../lib/theme';
import { Accounts } from '../pages/Accounts';
import { Ledger } from '../pages/Ledger';
import { Overview } from '../pages/Overview';
import { Reliability } from '../pages/Reliability';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet, end: false },
  { to: '/ledger', label: 'Ledger', icon: ListTree, end: false },
  { to: '/reliability', label: 'Reliability', icon: ShieldCheck, end: false },
] as const;

const TITLES: Record<string, string> = {
  '/': 'Overview',
  '/accounts': 'Accounts',
  '/ledger': 'Ledger',
  '/reliability': 'Reliability',
};

function Sidebar(): React.JSX.Element {
  const { recon } = useData();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div className="brand-text">
          <span className="brand-name">SETTLE</span>
          <span className="brand-tag">Ledger Control</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`integrity ${recon?.balanced ? 'integrity-ok' : 'integrity-bad'}`}>
          <ShieldCheck size={15} />
          <div>
            <span className="integrity-status">
              {recon ? (recon.balanced ? 'Books balanced' : 'Drift detected') : 'Checking…'}
            </span>
            <span className="integrity-sub">double-entry invariant</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Topbar(): React.JSX.Element {
  const { recon, error, lastUpdated, refresh } = useData();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Overview';

  const status = error ? 'down' : recon ? 'live' : 'connecting';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">{title}</h1>
        <div className={`live-pill live-${status}`}>
          <span className="live-dot" />
          {status === 'live' ? 'Live' : status === 'down' ? 'Offline' : 'Connecting'}
        </div>
      </div>
      <div className="topbar-right">
        {lastUpdated && (
          <span className="topbar-sync">
            <Activity size={13} /> synced {fmtRelativeTime(lastUpdated.toISOString())}
          </span>
        )}
        <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  );
}

export function AppShell(): React.JSX.Element {
  const location = useLocation();
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          {/* Keyed wrapper re-mounts per route so the CSS entrance replays. */}
          <div key={location.pathname} className="page-enter">
            <Routes location={location}>
              <Route path="/" element={<Overview />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/reliability" element={<Reliability />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
