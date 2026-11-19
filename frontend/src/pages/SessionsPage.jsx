import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import CalendarWorkspace from '../components/CalendarWorkspace';
import { Icon } from '../components/icons';
import { formatShort, parseISODate } from '../lib/dates';

export default function SessionsPage({ user, sessions = [], requests = [], availability = {} }) {
  const [params] = useSearchParams();
  const visibleSessions = sessions.filter((session) => user.role === 'student' ? session.studentName === user.name : session.tutorId === user.tutorId);
  const visibleRequests = requests.filter((request) => user.role === 'student' ? request.studentName === user.name : request.tutorId === user.tutorId);
  const items = [
    ...visibleSessions.map((item) => ({ id: `session-${item.id}`, date: item.date, time: item.time, label: `${item.subject} · ${user.role === 'student' ? item.tutorName : item.studentName}`, detail: item.location ? `In person at ${item.location}` : item.topic, type: 'session', mode: item.mode })),
    ...visibleRequests.map((item) => ({ id: `request-${item.id}`, date: item.date, time: item.time, label: `${item.subject} · ${user.role === 'student' ? item.tutorName : item.studentName}`, detail: item.location ? `${item.status} · in person at ${item.location}` : `${item.status} request`, type: 'request', mode: item.mode })),
  ];

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><span className="eyebrow">{user.role === 'student' ? 'My learning schedule' : 'Teaching schedule'}</span><h1>{user.role === 'student' ? 'My sessions.' : 'Your sessions.'}</h1><p>{user.role === 'student' ? 'A focused place for confirmed sessions, pending requests, and the days you have room to learn.' : 'See confirmed sessions and requests without mixing them into the rest of your workspace.'}</p></div><div className="workspace-header-actions">{user.role === 'student' ? <Link className="primary-button" to="/find"><Icon name="plus" size={16} /> Find a tutor</Link> : <Link className="primary-button" to="/availability"><Icon name="plus" size={16} /> Add availability</Link>}</div></header>
      <CalendarWorkspace items={items} availability={availability} tutorId={user.role === 'tutor' ? user.tutorId : undefined} allowManage={false} />
      <section className="workspace-list-card"><div className="section-head-inline"><div><span className="eyebrow">All sessions</span><h2>{visibleSessions.length} saved session{visibleSessions.length !== 1 ? 's' : ''}</h2><p>Requests remain separate so the final calendar never hides their status.</p></div><Link className="text-link" to="/requests">Open requests <Icon name="arrowRight" size={14} /></Link></div>{visibleSessions.length ? <div className="workspace-session-list">{visibleSessions.map((item) => <article className="workspace-session" key={item.id}><div className="workspace-session-date"><strong>{parseISODate(item.date).getDate()}</strong><span>{new Intl.DateTimeFormat('en', { month: 'short' }).format(parseISODate(item.date))}</span></div><div><span className="eyebrow">{item.status}</span><h3>{item.subject}</h3><p>{item.topic}</p><span>{formatShort(item.date)} · {item.time} · {item.mode}{item.location ? ` · ${item.location}` : ''}</span></div><Link className="ghost-button" to={`/sessions?date=${item.date}`}>View on calendar</Link></article>)}</div> : <div className="empty-state large"><Icon name="calendar" size={22} /><strong>No sessions yet.</strong><span>Once a request is confirmed, it will appear here.</span><Link className="ghost-button" to="/find">Find a tutor</Link></div>}</section>
      {params.get('date') && <div className="calendar-deep-link-note"><Icon name="calendar" size={14} /> Opened for <strong>{formatShort(params.get('date'))}</strong>. Choose the day in the calendar above.</div>}
    </div>
  );
}
