import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';

// `user` is intentionally not destructured here: the notification list arrives already
// scoped to the signed-in account by App state, so the page needs nothing from the
// record itself. App.jsx still passes the prop; React simply ignores it.
export default function ActivityPage({ notifications = [], notificationsOnly = false }) {
  // Derived from App state (visible sessions + requests) instead of a static array,
  // so an account with no activity yet lands on the empty state below without crashing.
  const items = notifications;
  return (
    <div className="workspace-page activity-page-full">
      <header className="workspace-header"><div><span className="eyebrow">{notificationsOnly ? 'All updates' : 'Activity'}</span><h1>{notificationsOnly ? 'Notifications.' : 'What changed.'}</h1><p>{notificationsOnly ? 'Every update from your tutoring flow stays here, without an unread badge or hidden state.' : 'A calm timeline for the things that happened around your requests and sessions.'}</p></div><div className="workspace-header-actions"><Link className="ghost-button" to={notificationsOnly ? '/activity' : '/notifications'}>{notificationsOnly ? 'Open activity' : 'Open notifications'} <Icon name="arrowRight" size={14} /></Link></div></header>
      <section className="activity-feed-card"><div className="activity-feed-head"><span className="eyebrow">{items.length} updates</span><h2>{notificationsOnly ? 'Notifications center' : 'Recent activity'}</h2></div>{items.length ? <div className="activity-feed-list">{items.map((item) => <article className="activity-feed-item" key={item.id}><span className="feed-icon"><Icon name={item.type === 'session' ? 'calendar' : item.type === 'request' ? 'users' : item.type === 'reminder' ? 'bell' : 'spark'} size={17} /></span><div><strong>{item.title}</strong><p>{item.body}</p><span>{item.time}</span></div><Link className="icon-button" to={item.type === 'request' || item.type === 'schedule' ? '/requests' : item.type === 'tutor' ? '/find' : '/sessions'} aria-label={`Open ${item.title}`}><Icon name="arrowRight" size={15} /></Link></article>)}</div> : <div className="empty-state large"><Icon name="bell" size={22} /><strong>No updates yet.</strong><span>Updates will appear here as your requests and sessions change.</span></div>}</section>
    </div>
  );
}
