import React, { useMemo, useRef, useState } from 'react';
import CalendarWorkspace, { datesForWeek } from '../components/CalendarWorkspace';
import { Icon } from '../components/icons';
import { findTutor } from '../lib/selectors';
import { CAMPUS_SPOTS, indefiniteArticle, makeSlot, slotKey } from '../lib/slots';
import { blockImplicitSubmit } from '../lib/forms';

export default function AvailabilityPage({ user, tutors = [], availability = {}, onAddAvailability, onRemoveAvailability }) {
  const tutor = findTutor(tutors, user.tutorId) || user;
  const formRef = useRef(null);
  // Every published slot, including anything added this session, is read from App state
  // so the agenda and the open-slots panel can never disagree about the same day.
  const mergedItems = useMemo(
    () => Object.entries(availability?.[tutor.id] || {}).flatMap(([date, slots]) => slots.map((slot) => ({
      id: `${date}-${slot.time}-${slot.mode}`,
      date,
      time: slot.time,
      label: 'Published availability',
      detail: slot.mode === 'Offline' ? `In person at ${slot.location} · ${slot.duration} minutes` : `Online · ${slot.duration} minutes`,
      type: 'event',
      mode: slot.mode,
    }))),
    [availability, tutor.id],
  );
  const [date, setDate] = useState(datesForWeek(0)[0]);
  const [time, setTime] = useState('09:00');
  const [mode, setMode] = useState('Online');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const chooseMode = (next) => {
    setMode(next);
    if (next === 'Online') setLocation('');
    setError('');
    setSuccess('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (mode === 'Offline' && !location.trim()) return setError('Add a meeting room for an in-person slot.');

    const slot = makeSlot({ time, mode, location: location.trim() });
    // App silently ignores a slot that is already published, so check it here and
    // say so, otherwise pressing the button twice looks like nothing happened.
    const alreadyThere = (availability[tutor.id]?.[date] || []).some((item) => slotKey(item) === slotKey(slot));
    if (alreadyThere) {
      setSuccess('');
      return setError(`You already have ${indefiniteArticle(mode)} ${mode.toLowerCase()} slot at ${time} on ${date}.`);
    }

    onAddAvailability(tutor.id, date, slot);
    setError('');
    setSuccess(`Published ${time} · ${mode}${mode === 'Offline' ? ` at ${location.trim()}` : ''} on ${date}. It is now discoverable by students.`);
    setLocation('');
  };

  // "Add another slot" in the calendar panel scrolls to and focuses this form, which
  // is what that button should do on a page that is already the availability screen.
  const focusForm = () => {
    const form = formRef.current;
    if (!form) return;
    // Guarded because scrollIntoView is missing in some non-browser test environments.
    if (typeof form.scrollIntoView === 'function') form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    form.querySelector('input')?.focus();
  };

  if (user.role !== 'tutor') return <div className="empty-state large"><strong>Availability is tutor-only.</strong><span>Student users can view tutor availability from a profile.</span></div>;
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><span className="eyebrow">Tutor tools</span><h1>Your availability.</h1><p>Publish the hours you are actually ready to teach. Students see these slots on your profile.</p></div></header>
      <section className="availability-manager-grid">
        <form className="availability-create-card card-surface" onSubmit={submit} onKeyDown={blockImplicitSubmit} ref={formRef}><div className="section-head-inline"><div><span className="eyebrow">Add a slot</span><h2>Open another hour.</h2><p>One controlled form, immediate visible output.</p></div></div><label>Date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setError(''); setSuccess(''); }} /></label><label>Start time<input type="time" value={time} onChange={(event) => { setTime(event.target.value); setError(''); setSuccess(''); }} /></label><span className="field-label">Format</span><div className="filter-toggle-row wide-toggle">{['Online', 'Offline'].map((item) => <button type="button" key={item} className={mode === item ? 'selected' : ''} onClick={() => chooseMode(item)}>{item}</button>)}</div>{mode === 'Offline' && <label className="field-block">Meeting room<input list="availability-spots" value={location} onChange={(event) => { setLocation(event.target.value); setError(''); setSuccess(''); }} placeholder="e.g. Library study zone, 2nd floor" /><datalist id="availability-spots">{CAMPUS_SPOTS.map((spot) => <option value={spot} key={spot} />)}</datalist></label>}{error && <div className="form-error" role="alert"><Icon name="x" size={15} /><span>{error}</span></div>}{success && <div className="form-success-inline" role="status"><Icon name="check" size={15} /><span>{success}</span></div>}<div className="availability-create-note"><Icon name="check" size={15} /><span>New slots appear immediately in this prototype&rsquo;s React state.</span></div><button className="primary-button full" type="submit">Publish availability <Icon name="arrowRight" size={15} /></button></form>
        <div><CalendarWorkspace items={mergedItems} availability={availability} tutorId={tutor.id} allowManage onRemoveAvailability={onRemoveAvailability} onAddAvailability={onAddAvailability} onAddSlot={focusForm} /></div>
      </section>
    </div>
  );
}
