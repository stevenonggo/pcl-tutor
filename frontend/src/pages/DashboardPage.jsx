import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { Icon } from '../components/icons';
import { SUBJECTS } from '../data/catalog';

function formatDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

// The week window is derived from the local "today" instead of a fixed demo date, so the
// snapshot follows the live calendar. ISO dates are built from local parts to avoid the
// UTC off-by-one day shift that toISOString() causes in timezones ahead of UTC.
function nextDates(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
}

function QuickCalendar({ sessions, requests, role }) {
  const navigate = useNavigate();
  const nextDays = nextDates(5);
  const items = [
    ...sessions.map((session) => ({ id: session.id, date: session.date, time: session.time, label: session.subject, type: 'session' })),
    ...requests.map((request) => ({ id: request.id, date: request.date, time: request.time, label: `${request.subject} · ${role === 'tutor' ? request.studentName : request.tutorName}`, type: 'request' })),
  ];

  return (
    <section className="home-card home-calendar-card">
      <div className="home-card-head"><div><span className="eyebrow">This week</span><h2>Calendar snapshot</h2><p>Only your next commitments stay visible here.</p></div><Link className="text-link" to="/sessions">Open calendar <Icon name="arrowRight" size={14} /></Link></div>
      <div className="mini-week">
        {nextDays.map((date) => {
          const day = new Date(`${date}T12:00:00`);
          const dayItems = items.filter((item) => item.date === date).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
          return (
            <button type="button" className={`mini-day ${dayItems.length ? 'has-item' : ''}`} key={date} onClick={() => navigate(`/sessions?date=${date}`)}>
              <span>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day)}</span>
              <strong>{day.getDate()}</strong>
              <small>{dayItems[0] ? dayItems[0].time : 'Open'}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PendingSummary({ requests, role }) {
  const navigate = useNavigate();
  const pending = requests.filter((item) => item.status === 'Pending' || (role === 'student' && item.status === 'Suggested'));
  const featured = pending.slice(0, 2);
  return (
    <section className="home-card pending-summary">
      <div className="home-card-head"><div><span className="eyebrow">Needs attention</span><h2>Pending requests</h2><p>{pending.length ? `${pending.length} request${pending.length > 1 ? 's' : ''} need your attention.` : 'Nothing is waiting right now.'}</p></div><span className="count-badge">{pending.length}</span></div>
      {featured.length ? <div className="pending-preview-list">{featured.map((item) => (
        <button type="button" key={item.id} className="pending-preview" onClick={() => navigate('/requests')}>
          <Avatar initials={role === 'tutor' ? item.studentInitials : item.subject.slice(0, 2).toUpperCase()} accent={role === 'tutor' ? '#3568C8' : '#0B8F68'} />
          <span className="pending-preview-copy"><strong>{role === 'tutor' ? item.studentName : item.subject}</strong><small>{item.topic}</small><em>{formatDate(item.date)} · {item.time}</em></span>
          <span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span>
        </button>
      ))}</div> : <div className="home-empty"><Icon name="check" size={18} /><span>You're all caught up.</span></div>}
      <button type="button" className="secondary-button full-inline" onClick={() => navigate('/requests')}>Open requests <Icon name="arrowRight" size={14} /></button>
    </section>
  );
}

function SearchHero({ onSearch }) {
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const subjects = SUBJECTS.slice(0, 5);
  const submit = (event) => {
    event.preventDefault();
    onSearch(query || subject ? { q: query, subject } : {});
  };
  return (
    <section className="search-hero home-search-hero">
      <div className="search-hero-copy"><span className="eyebrow">Start here</span><h2>What do you need help with?</h2><p>Search the subject first. Then compare tutors on one calm, focused page.</p></div>
      <form className="search-box-wrap" onSubmit={submit}>
        <Icon name="search" size={19} />
        <input aria-label="Search tutor or subject" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a subject or tutor…" />
        <button type="submit" className="primary-button small search-submit">Search</button>
      </form>
      <div className="subject-filter-row">{subjects.map((item) => <button type="button" className={`filter-chip ${subject === item ? 'selected' : ''}`} key={item} onClick={() => { setSubject(item); setQuery(''); onSearch({ subject: item }); }}>{item}</button>)}<button type="button" className="filter-chip more" onClick={() => onSearch({})}>Browse all subjects</button></div>
    </section>
  );
}

export default function DashboardPage({ user, sessions = [], requests = [], tutors = [], availability = {} }) {
  const navigate = useNavigate();
  // A session can reference a tutor that no longer exists in the database; every read
  // of the resolved record below uses optional chaining, so a missing record degrades
  // to a fallback display instead of crashing the dashboard.
  if (!user) return null;
  const isStudent = user.role === 'student';
  const visibleSessions = sessions.filter((session) => (
    isStudent
      ? (session.studentId ? session.studentId === user.id : session.studentName === user.name)
      : (session.tutorId === user.tutorId || session.tutorId === user.id)
  ));
  const nextSession = visibleSessions.find((session) => session.status === 'Confirmed') || visibleSessions[0];
  const currentTutor = tutors.find((item) => item.id === nextSession?.tutorId || item.tutorId === nextSession?.tutorId) || null;
  const tutorAvailability = availability?.[user.tutorId] || availability?.[user.id] || {};
  const weekDays = nextDates(5).map((value) => ({
    label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(`${value}T12:00:00`)),
    value,
  }));

  const goSearch = (params) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.subject) search.set('subject', params.subject);
    navigate(`/find${search.toString() ? `?${search}` : ''}`);
  };

  return (
    <div className="dashboard-page clean-dashboard">
      <section className="page-intro home-intro">
        <div><span className="eyebrow">{isStudent ? 'Student workspace' : 'Tutor workspace'}</span><h1>{isStudent ? 'Find help that fits your schedule.' : 'Make every tutoring hour count.'}</h1><p>{isStudent ? 'PCL Tutor keeps the discovery, request, and calendar flow simple so you can get to the right study session quickly.' : 'Handle the requests that matter, keep your schedule visible, and publish availability without digging through unrelated pages.'}</p></div>
        <div className="page-intro-actions"><button className="primary-button" onClick={() => navigate(isStudent ? '/find' : '/availability')}><Icon name="plus" size={16} /> {isStudent ? 'Quick book' : 'Add availability'}</button></div>
      </section>

      {isStudent ? (
        <>
          <SearchHero onSearch={goSearch} />
          <section className="home-primary-grid">
            <PendingSummary requests={requests} role="student" />
            <section className="home-card next-session-compact">
              <div className="home-card-head"><div><span className="eyebrow">Next session</span><h2>{nextSession ? nextSession.subject : 'No session yet'}</h2><p>{nextSession ? nextSession.topic : 'Your confirmed study sessions will appear here.'}</p></div><span className={`status-pill ${nextSession?.status?.toLowerCase() || 'pending'}`}>{nextSession?.status || 'Open'}</span></div>
              {nextSession ? <><div className="next-session-line"><strong>{formatDate(nextSession.date)}</strong><span>{nextSession.time} · {nextSession.mode}{nextSession.location ? ` · ${nextSession.location}` : ''}</span></div><div className="next-session-person"><Avatar initials={currentTutor?.initials || nextSession.tutorName?.slice(0, 2).toUpperCase() || '?'} accent={currentTutor?.accent || '#0B8F68'} /><div><strong>{nextSession.tutorName}</strong><span>{currentTutor?.major || 'Tutor'}</span></div></div><Link className="secondary-button" to="/sessions">See all sessions <Icon name="arrowRight" size={14} /></Link></> : <Link className="primary-button" to="/find">Find a tutor</Link>}
            </section>
          </section>
          <QuickCalendar sessions={visibleSessions} requests={requests} role="student" />
        </>
      ) : (
        <>
          <section className="tutor-home-grid">
            <section className="home-card tutor-next-card">
              <div className="home-card-head"><div><span className="eyebrow">Upcoming session</span><h2>{nextSession ? nextSession.subject : 'You are all clear.'}</h2><p>{nextSession ? nextSession.topic : 'No confirmed sessions are on your schedule yet.'}</p></div><span className={`status-pill ${nextSession?.status?.toLowerCase() || 'confirmed'}`}>{nextSession?.status || 'Open'}</span></div>
              {nextSession && <div className="tutor-next-detail"><div><span className="muted-label">When</span><strong>{formatDate(nextSession.date)}</strong><span>{nextSession.time} · {nextSession.mode}</span></div><div><span className="muted-label">Student</span><strong>{nextSession.studentName}</strong><span>Student / Mentee</span></div></div>}
              <div className="home-card-actions"><Link className="secondary-button" to="/sessions">Open calendar</Link><Link className="primary-button" to="/requests">Review requests</Link></div>
            </section>
            <section className="home-card availability-snapshot"><div className="home-card-head"><div><span className="eyebrow">Your week</span><h2>Availability</h2><p>Keep your open hours easy to discover.</p></div><Link className="text-link" to="/availability">Manage <Icon name="arrowRight" size={14} /></Link></div><div className="availability-snapshot-grid">{weekDays.map((day) => <button type="button" key={day.value} onClick={() => navigate('/availability')}><span>{day.label}</span><strong>{(tutorAvailability[day.value] || []).length}</strong><small>open slots</small></button>)}</div></section>
          </section>
          <PendingSummary requests={requests} role="tutor" />
          <QuickCalendar sessions={visibleSessions} requests={requests} role="tutor" />
        </>
      )}
    </div>
  );
}
