import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useSession } from '../context/SessionContext';
import { SECTIONS, type Section } from '../nav';
import NavTip from './NavTip';
import UserMenu from './UserMenu';

// Ported from Outreach's Layout.tsx: same sidebar, top bar, collapse rail and
// phone drawer, with Clientline's sections.

/** One sidebar link. The label sits in its own span so the collapsed rail can hide it
 *  with CSS, and carries a native tooltip while collapsed since the text is gone. */
function NavItem({ section, collapsed, onNavigate }: { section: Section; collapsed: boolean; onNavigate: () => void }) {
  const { path, icon, label, tip } = section;
  return (
    <NavLink to={path} end={path === '/'} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
      className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={onNavigate}>
      <i className={`ti ${icon}`} /> <span className="nav-label">{label}</span>
      <NavTip text={tip} />
    </NavLink>
  );
}

export default function Layout({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const { signedIn } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop only: a 64px icon rail. The phone drawer is always full width (see theme.css).
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('clientline-sidebar') === 'collapsed'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('clientline-sidebar', collapsed ? 'collapsed' : 'open'); } catch { /* private mode */ }
  }, [collapsed]);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // A drawer that covers the page has to be dismissable from the keyboard, and
  // focus has to come back to the control that opened it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); menuBtnRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);
  const item = (s: Section) => <NavItem key={s.path} section={s} collapsed={collapsed} onNavigate={close} />;

  const nav = (
    <>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon"><i className="ti ti-briefcase" /></div>
        <span className="sidebar-logo-text">Clientline</span>
        <button type="button" className="sidebar-collapse-btn" onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <i className={`ti ${collapsed ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse'}`} />
        </button>
      </div>
      {SECTIONS.filter(s => !s.group).map(item)}
      <div className="nav-section-label">Setup</div>
      {SECTIONS.filter(s => s.group === 'setup').map(item)}
      <div className="sidebar-bottom">
        <button className="theme-toggle" type="button" onClick={toggleTheme}
          aria-label={`Appearance: ${theme === 'dark' ? 'dark' : 'light'}. Switch to ${theme === 'dark' ? 'light' : 'dark'}.`}>
          <span className="tt-icon"><i className="ti ti-sun" /><i className="ti ti-moon" /><span className="nav-label">Appearance</span></span>
          <span className="tt-state">{theme === 'dark' ? 'Dark' : 'Light'}</span>
        </button>
      </div>
    </>
  );

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside id="sidebar-nav" className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Main">{nav}</aside>
      {/* Always mounted: a backdrop that only appears with .open already applied
          has nothing to transition from, so the fade never ran. */}
      <div className={`sidebar-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-btn" type="button" ref={menuBtnRef}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="sidebar-nav"
              onClick={() => setMenuOpen(o => !o)}>
              <i className="ti ti-menu-2" />
            </button>
            <div>
              <h1>{title}</h1>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="topbar-actions">{actions}</div> : null}
          {signedIn && (
            <div className="topbar-tools">
              <UserMenu />
            </div>
          )}
        </div>
        <main id="main"><div className="section" style={{ flex: 1 }}>{children}</div></main>
      </div>
    </div>
  );
}
