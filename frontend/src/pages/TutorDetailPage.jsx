import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { Icon } from '../components/icons';
import { slotKey } from '../lib/slots';

function formatDate(date) {
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

function nextSevenDates() {
  const start = new Date('2026-09-28T12:00:00');
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export default function TutorDetailPage({ user, tutors = [], availability = {} }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const tutor = tutors.find((item) => item.id === id || item.tutorId === id);
  const dates = useMemo(nextSevenDates, []);
  // Published and tutor-added slots live in the same App state now, so there is one
  // list per day and no merge that could offer the same hour twice.
  const slotsByDate = availability?.[tutor?.id] || {};
  const [selectedDate, setSelectedDate] = useState(dates.find((date) => slotsByDate[date]) || dates[0]);

  if (!tutor) return <div className="empty-state large"><strong>Tutor not found.</strong><span>This tutor is no longer listed in the workspace.</span><Link className="ghost-button" to="/find">Back to tutor library</Link></div>;

  const slots = [...(slotsByDate[selectedDate] || [])].sort((a, b) => a.time.localeCompare(b.time));
  const isStudent = user?.role === 'student';

  return (
    <div className="detail-page detail-page-v2">
      <div className="detail-topbar"><button className="back-button" onClick={() => navigate(-1)}><Icon name="arrowLeft" size={16} /> Back</button><span className="detail-breadcrumb">Tutor profile / {tutor.name}</span></div>

      <section className="profile-hero-v2">
        <div className="profile-hero-art" style={{ '--profile-accent': tutor.accent }}><span className="profile-grid-mark" /><span className="profile-hero-label">PCL TUTOR</span><strong>{tutor.subjects[0] || 'New tutor'}</strong></div>
        <div className="profile-hero-copy"><div className="profile-hero-identity"><Avatar initials={tutor.initials} accent={tutor.accent} size="lg" /><div><span className="eyebrow">Tutor / Mentor</span><h1>{tutor.name}</h1><p>{tutor.major} · Semester {tutor.semester}</p></div></div><p className="profile-hero-about">{tutor.about || 'This tutor has not added a bio yet.'}</p><div className="profile-hero-stats"><span><strong>{tutor.rating}</strong> rating</span><span><strong>{tutor.sessions}</strong> sessions</span><span><strong>{tutor.participantsToday}</strong> today</span></div><div className="profile-hero-actions">{isStudent && <Link className="primary-button" to={`/booking?tutor=${tutor.id}`}><Icon name="plus" size={16} /> Book a session</Link>}<Link className="ghost-button" to="/sessions"><Icon name="calendar" size={15} /> View full calendar</Link></div></div>
      </section>

      <section className="detail-content-grid">
        <section className="calendar-card profile-calendar-card">
          <div className="section-head-inline"><div><span className="eyebrow">Availability</span><h2>Choose a day.</h2><p>Open dates are interactive. Choose one to see exact slots.</p></div><Link className="text-link" to="/sessions">Open full calendar <Icon name="arrowRight" size={14} /></Link></div>
          <div className="profile-mini-calendar">{dates.map((date) => { const d = new Date(`${date}T12:00:00`); const count = (slotsByDate[date] || []).length; return <button type="button" key={date} className={`profile-mini-day ${selectedDate === date ? 'selected' : ''} ${count ? 'available' : ''}`} onClick={() => setSelectedDate(date)}><span>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(d)}</span><strong>{d.getDate()}</strong><small>{count ? `${count} open` : 'Closed'}</small></button>; })}</div>
          <div className="selected-date-panel"><div><span className="eyebrow">{formatDate(selectedDate)}</span><h3>{slots.length ? 'Open times' : 'No published times'}</h3></div>{slots.length ? <div className="slot-button-grid">{slots.map((slot) => <Link className="slot-button" key={slotKey(slot)} to={`/booking?tutor=${tutor.id}&date=${selectedDate}&time=${encodeURIComponent(slot.time)}`}><span className="slot-button-time"><strong>{slot.time}</strong><span className={`mode-pill tiny ${slot.mode.toLowerCase()}`}>{slot.mode}</span></span>{slot.mode === 'Offline' && <span className="slot-button-place">{slot.location}</span>}<Icon name="arrowRight" size={14} /></Link>)}</div> : <div className="empty-state compact"><span>This tutor has no published slot on this day.</span>{isStudent && <Link className="secondary-button small" to={`/booking?tutor=${tutor.id}&date=${selectedDate}&custom=1`}>Request a custom time</Link>}</div>}</div>
          {isStudent && <div className="calendar-secondary-actions"><Link className="ghost-button" to={`/booking?tutor=${tutor.id}&custom=1`}>Request a custom time</Link><span>Prefer a different time? Ask the tutor to propose another schedule.</span></div>}
        </section>

        <aside className="profile-side-column">
          <section className="side-info-card"><span className="eyebrow">Subjects</span><h3>What they can help with</h3><div className="subject-stack">{tutor.subjects.length ? tutor.subjects.map((subject) => <span className="subject-chip" key={subject}>{subject}</span>) : <span className="muted-label">No subjects added yet.</span>}</div></section>
          <section className="side-info-card"><span className="eyebrow">Format</span><h3>How sessions work</h3><div className="mode-stack">{tutor.modes.length ? tutor.modes.map((mode) => <span className="mode-pill" key={mode}>{mode}</span>) : <span className="muted-label">No published formats yet.</span>}</div><p>Choose your format during booking. The tutor confirms the final request.</p></section>
          <section className="side-info-card"><span className="eyebrow">Activity</span><h3>Today</h3><div className="activity-stat-row"><strong>{tutor.participantsToday}</strong><span>participants have sessions with this tutor today.</span></div></section>
        </aside>
      </section>
    </div>
  );
}
