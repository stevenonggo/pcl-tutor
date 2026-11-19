import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import { Icon } from '../components/icons';
import { formatShort } from '../lib/dates';

export default function RequestsPage({ user, requests = [], onRequestAction }) {
  const navigate = useNavigate();
  const pending = requests.filter((item) => item.status === 'Pending' || (user.role === 'student' && item.status === 'Suggested'));
  const decided = requests.filter((item) => !pending.includes(item));
  const isTutor = user.role === 'tutor';
  // Accepting is easy to reverse by asking the student, but a decline or a cancellation
  // cannot be undone from either side, so it waits for a confirmation first.
  const [destructive, setDestructive] = useState(null);

  const confirmDestructive = () => {
    if (!destructive) return;
    onRequestAction(destructive.item.id, 'rejected');
    setDestructive(null);
  };

  const askToRemove = (item) => setDestructive({ item, isTutor });

  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><span className="eyebrow">{isTutor ? 'Incoming requests' : 'My requests'}</span><h1>{isTutor ? 'Decide with context.' : 'Keep requests easy to follow.'}</h1><p>{isTutor ? 'Open one request, understand the student’s need, then accept, suggest another time, or decline.' : 'Pending requests live here until your tutor confirms or proposes another time.'}</p></div>{!isTutor && <button className="primary-button" onClick={() => navigate('/find')}><Icon name="plus" size={16} /> New request</button>}</header>
      <section className="request-workspace-card"><div className="request-workspace-head"><div><span className="eyebrow">Needs attention</span><h2>{pending.length} pending</h2></div><span className="status-pill pending">Live demo</span></div>{pending.length ? <div className="request-workspace-list">{pending.map((item) => <article className="request-workspace-item" key={item.id}><Avatar initials={isTutor ? item.studentInitials : item.subject.slice(0, 2).toUpperCase()} accent={isTutor ? '#3568C8' : '#0B8F68'} size="lg" /><div className="request-workspace-copy"><span className="eyebrow">{item.status === 'Suggested' ? 'Tutor suggested' : 'Request'}</span><h3>{isTutor ? item.studentName : item.subject}</h3><strong>{item.topic}</strong><p>{formatShort(item.date)} · {item.time} · {item.mode}{item.location ? ` · ${item.location}` : ''}</p><span>{item.message}</span></div><div className="request-workspace-actions">{isTutor ? <><button className="primary-button small" onClick={() => onRequestAction(item.id, 'confirmed')}>Accept</button><button className="ghost-button small" onClick={() => navigate(`/booking?mode=suggest&request=${item.id}`)}>Suggest time</button><button className="danger-button" onClick={() => askToRemove(item)}>Decline</button></> : item.status === 'Suggested' ? <><button className="primary-button small" onClick={() => navigate(`/booking?mode=review&request=${item.id}`)}>Review suggestion</button><button className="ghost-button small" onClick={() => askToRemove(item)}>Cancel request</button></> : <span className="status-pill pending">Waiting for tutor</span>}</div></article>)}</div> : <div className="empty-state large"><Icon name="check" size={22} /><strong>No requests need a decision.</strong><span>{isTutor ? 'New student requests will appear here.' : 'Your pending requests will appear here.'}</span></div>}</section>
      {decided.length > 0 && <section className="request-history-card"><div className="section-head-inline"><div><span className="eyebrow">History</span><h2>Past decisions</h2></div></div><div className="decision-list">{decided.map((item) => <article key={item.id}><div><strong>{isTutor ? item.studentName : item.subject}</strong><span>{item.topic}</span></div><span className={`status-pill ${item.status.toLowerCase()}`}>{item.status}</span></article>)}</div></section>}

      <ConfirmDialog
        open={Boolean(destructive)}
        title={destructive?.isTutor ? 'Decline this request?' : 'Cancel this request?'}
        description={destructive
          ? `${destructive.item.topic} · ${formatShort(destructive.item.date)} at ${destructive.item.time} with ${destructive.isTutor ? destructive.item.studentName : destructive.item.tutorName}. The request moves to ${destructive.isTutor ? 'Declined' : 'Cancelled'} and the matching session is closed.`
          : ''}
        confirmLabel={destructive?.isTutor ? 'Decline request' : 'Cancel request'}
        onConfirm={confirmDestructive}
        onCancel={() => setDestructive(null)}
      />
    </div>
  );
}
