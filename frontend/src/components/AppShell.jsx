import React, { useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import Brand from './Brand';
import Avatar from './Avatar';
import ConfirmDialog from './ConfirmDialog';
import NotificationPopover from './NotificationPopover';
import { Icon } from './icons';

const studentNav = [
  { label: 'Home', to: '/', icon: 'home', end: true },
  { label: 'Find a Tutor', to: '/find', icon: 'search' },
  { label: 'Study Plan', to: '/study-plan', icon: 'plan' },
  { label: 'Requests', to: '/requests', icon: 'users' },
  { label: 'My Sessions', to: '/sessions', icon: 'calendar' },
];

const tutorNav = [
  { label: 'Home', to: '/', icon: 'home', end: true },
  { label: 'Requests', to: '/requests', icon: 'users' },
  { label: 'Availability', to: '/availability', icon: 'clock' },
  { label: 'Sessions', to: '/sessions', icon: 'calendar' },
  { label: 'Subjects', to: '/subjects', icon: 'book' },
];

export default function AppShell({ user, notifications = [], children, collapsed, setCollapsed, onOpenSettings, onLogout }) {
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  // Keep navigation role-aware so each actor only sees actions relevant to them.
  const nav = user.role === 'tutor' ? tutorNav : studentNav;

  useEffect(() => setMobileOpen(false), [location.pathname, location.search]);

  // The header label is derived from the current route instead of hardcoded per page.
  const pageLabel = location.pathname === '/' ? 'Home' : location.pathname.slice(1).split('/')[0].replace('-', ' ');

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-top">
          <Link to="/" className="brand-link"><Brand compact={collapsed} /></Link>
          <button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            <Icon name="menu" size={17} />
          </button>
        </div>

        <div className="role-label">
          <span className="role-dot" />
          <span>{user.role === 'tutor' ? 'Tutor / Mentor' : 'Student / Mentee'}</span>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {nav.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              key={item.label}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-foot">
          {/* Activity now carries the unread count that used to sit on the removed
              Notifications item, so the badge follows the notification data rather than a
              sidebar entry that no longer exists. The panel itself is still opened from
              the topbar bell, which is untouched. */}
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to="/activity" title={collapsed ? 'Activity' : undefined}>
            <Icon name="spark" size={18} /><span>Activity</span>{!collapsed && <span className="nav-count">{notifications.length}</span>}
          </NavLink>
          <NavLink className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} to="/profile" title={collapsed ? 'Profile' : undefined}>
            <Icon name="profile" size={18} /><span>Profile</span>
          </NavLink>
          <button className="nav-item" onClick={onOpenSettings} title={collapsed ? 'Settings' : undefined}><Icon name="settings" size={18} /><span>Settings</span></button>
          <button className="nav-item danger-link" onClick={() => setLogoutOpen(true)} title={collapsed ? 'Log out' : undefined}><Icon name="logout" size={18} /><span>Log out</span></button>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icon name="menu" size={19} /></button>
          <div className="topbar-context">
            <Link to="/" className="context-kicker">PCL Tutor</Link>
            <span className="context-separator">/</span>
            <span>{pageLabel}</span>
          </div>
          <div className="topbar-actions">
            <div className="notification-anchor">
              <button className={`top-icon ${notificationsOpen ? 'active' : ''}`} onClick={() => setNotificationsOpen((v) => !v)} aria-label="Open notifications" title="Notifications">
                <Icon name="bell" size={18} />
                <span className="updates-count">{notifications.length}</span>
              </button>
              {notificationsOpen && <NotificationPopover items={notifications} onClose={() => setNotificationsOpen(false)} />}
            </div>
            <Link className="profile-chip" to="/profile" title="Open profile">
              <Avatar initials={user.initials} accent={user.role === 'tutor' ? '#3568C8' : '#0B8F68'} size="sm" />
              <div className="profile-copy"><strong>{user.name}</strong><span>{user.role === 'tutor' ? 'Tutor' : 'Student'}</span></div>
              <Icon name="chevron" size={14} />
            </Link>
          </div>
        </header>
        <div className="page-area">{children}</div>
      </main>

      <ConfirmDialog
        open={logoutOpen}
        title="Log out of PCL Tutor?"
        description={`You are signed in as ${user.name}. Your saved profile stays on this device, but any requests, sessions, or availability you changed in this session will be lost.`}
        confirmLabel="Log out"
        onConfirm={() => { setLogoutOpen(false); onLogout(); }}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}